import type { Entity, Tag } from "./types";

export function groupTags<T extends Entity & Partial<Pick<Tag, "groupId">>>(
  tags: T[],
  groups: Entity[],
) {
  const sections = new Map(
    groups.map(({ id, name }) => [id, { id, name, tags: [] as T[] }]),
  );
  const ungrouped = { id: "", name: "未分组", tags: [] as T[] };
  for (const tag of tags) {
    const group = sections.get(tag.groupId ?? "") ?? ungrouped;
    group.tags.push(tag);
  }
  return [...sections.values(), ungrouped].filter(({ tags }) => tags.length);
}
