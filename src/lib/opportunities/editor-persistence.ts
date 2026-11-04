/** A workflow move must use the exact record whose latest draft was saved. */
export async function saveThenRunWorkflow<T>(
  save: () => Promise<string | null>,
  run: (savedId: string) => Promise<T>,
): Promise<{ saved: false } | { saved: true; result: T }> {
  const savedId = await save();
  if (!savedId) return { saved: false };
  return { saved: true, result: await run(savedId) };
}
/** Serialize autosaves and action saves so an older response cannot win later. */
export function createEditorSaveQueue() {
  let previous: Promise<unknown> = Promise.resolve();
  return <T>(save: () => Promise<T>): Promise<T> => {
    const next = previous.then(save);
    previous = next.catch(() => undefined);
    return next;
  };
}
