import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  desktop,
  libraryApi,
  type JobScope,
  type ListItemsRequest,
} from "./api";
import type { Catalog, Page } from "./types";

export const PAGE_SIZE = 60;
export const JOB_PAGE_SIZE = 100;
export type RefreshTarget = "items" | "roots" | "catalog" | "jobs";

const emptyCatalog: Catalog = {
  performers: [],
  studios: [],
  tag_groups: [],
  saved_filters: [],
};

interface ReadState<T> {
  key: string;
  data?: T;
  loading: boolean;
  error: string;
}

function useRead<T>(key: string | null, read: () => Promise<T>) {
  const [snapshot, setSnapshot] = useState<ReadState<T>>();
  const version = useRef(0);
  const readRef = useRef(read);
  useLayoutEffect(() => {
    readRef.current = read;
  }, [read]);
  useLayoutEffect(
    () => () => {
      version.current++;
    },
    [key],
  );

  const refresh = useCallback(async () => {
    if (key === null) return;
    const token = ++version.current;
    setSnapshot((previous) => ({
      key,
      data: previous?.key === key ? previous.data : undefined,
      loading: true,
      error: "",
    }));
    try {
      const data = await readRef.current();
      if (token === version.current)
        setSnapshot({ key, data, loading: false, error: "" });
    } catch (error) {
      if (token !== version.current) return;
      setSnapshot((previous) => ({
        key,
        data: previous?.key === key ? previous.data : undefined,
        loading: false,
        error: String(error),
      }));
      throw error;
    }
  }, [key]);

  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);

  return {
    data: snapshot?.key === key ? snapshot.data : undefined,
    loading: key === null || snapshot?.key !== key || snapshot.loading,
    error: snapshot?.key === key ? snapshot.error : "",
    refresh,
  };
}

export function useLibraryData(
  request: ListItemsRequest,
  searchReady: boolean,
  showJobs: boolean,
  scope: JobScope,
  jobPage: number,
  setPage: (page: number) => void,
  setJobPage: (page: number) => void,
) {
  const key = JSON.stringify(request);
  const order = useRef<{ key: string; ids: string[] } | undefined>(undefined);
  const page = useRead<Page>(searchReady ? key : null, () =>
    libraryApi.list(request),
  );
  const roots = useRead("roots", libraryApi.roots);
  const catalog = useRead("catalog", async () => {
    const [tags, catalog] = await Promise.all([
      libraryApi.tags(),
      libraryApi.catalog(),
    ]);
    return { tags, catalog };
  });
  const jobs = useRead(showJobs ? scope + ":" + jobPage : null, () =>
    libraryApi.jobs(scope, jobPage * JOB_PAGE_SIZE),
  );

  const last = page.data
    ? Math.max(0, Math.ceil(page.data.total / PAGE_SIZE) - 1)
    : null;
  const needsPage = last !== null && request.offset / PAGE_SIZE > last;
  useEffect(() => {
    if (needsPage) setPage(last);
  }, [needsPage, last, setPage]);
  useEffect(() => {
    if (
      !jobs.loading &&
      !jobs.error &&
      jobs.data?.length === 0 &&
      jobPage > 0
    ) {
      setJobPage(jobPage - 1);
    }
  }, [jobs.loading, jobs.error, jobs.data, jobPage, setJobPage]);

  let items = page.data?.items ?? [];
  const previous = order.current;
  if (previous?.key === key && request.filters.sort === "activity") {
    const ranks = new Map(previous.ids.map((id, index) => [id, index]));
    items = items
      .slice()
      .sort((a, b) => (ranks.get(a.id) ?? -1) - (ranks.get(b.id) ?? -1));
  }
  useLayoutEffect(() => {
    if (page.data && !needsPage)
      order.current = { key, ids: items.map((item) => item.id) };
  }, [page.data, key, needsPage]);

  const refreshers = useRef<Record<RefreshTarget, () => Promise<void>>>({
    items: page.refresh,
    roots: roots.refresh,
    catalog: catalog.refresh,
    jobs: jobs.refresh,
  });
  useLayoutEffect(() => {
    refreshers.current = {
      items: page.refresh,
      roots: roots.refresh,
      catalog: catalog.refresh,
      jobs: jobs.refresh,
    };
  }, [page.refresh, roots.refresh, catalog.refresh, jobs.refresh]);

  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    const timers = new Map<RefreshTarget, ReturnType<typeof setTimeout>>();
    const channels = {
      "library-changed": "items",
      "roots-changed": "roots",
      "jobs-changed": "jobs",
    } as const;
    const subscriptions = Object.entries(channels).map(([event, target]) =>
      listen(event, () => {
        if (disposed) return;
        clearTimeout(timers.get(target));
        timers.set(
          target,
          setTimeout(() => {
            timers.delete(target);
            void refreshers.current[target]().catch(() => {});
          }, 180),
        );
      }).catch(() => () => {}),
    );
    return () => {
      disposed = true;
      timers.forEach((timer) => clearTimeout(timer));
      subscriptions.forEach(
        (subscription) => void subscription.then((off) => off()),
      );
    };
  }, []);

  return {
    items: needsPage ? [] : items,
    total: page.data?.total ?? 0,
    loading: page.loading || needsPage,
    loadError: page.error,
    roots: roots.data ?? [],
    tags: catalog.data?.tags ?? [],
    catalog: catalog.data?.catalog ?? emptyCatalog,
    referenceError: roots.error || catalog.error,
    jobs: jobs.data ?? [],
    jobsLoading: jobs.loading,
    jobsError: jobs.error,
    resetOrder: () => {
      order.current = undefined;
    },
    async refresh(...targets: RefreshTarget[]) {
      const results = await Promise.allSettled(
        targets.map((target) => refreshers.current[target]()),
      );
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    },
  };
}
