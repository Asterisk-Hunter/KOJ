export type ClarificationViewer = {
  userId: string | null;
  role: string | null;
  suspended: boolean;
};

export type ClarificationRecord = {
  authorId: string;
  answer: string | null;
  visibility: "private" | "public";
};

export function canManageContestCommunication(viewer: ClarificationViewer): boolean {
  return viewer.userId !== null && !viewer.suspended && (viewer.role === "admin" || viewer.role === "setter");
}

export function canReadClarification(viewer: ClarificationViewer, record: ClarificationRecord): boolean {
  if (canManageContestCommunication(viewer)) return true;
  if (viewer.userId !== null && viewer.userId === record.authorId) return true;
  return record.visibility === "public" && record.answer !== null;
}
