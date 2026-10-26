/** Only syntax failures at the request-body boundary become client errors. */
export class InvalidJsonBodyError extends Error {
  constructor() {
    // Parser messages can contain submitted passwords, codes or member text.
    // Do not retain the original error as a cause or include its message.
    super('Request body must contain valid JSON.');
    this.name = 'InvalidJsonBodyError';
  }
}

export async function readJsonBody(
  request: Request,
  options: { allowEmpty?: boolean } = {},
): Promise<unknown> {
  // A failed stream read is not evidence of malformed JSON. Keep it outside
  // the parse catch so transport and programming errors remain observable.
  const body = await request.text();
  if (options.allowEmpty && body.length === 0) return {};
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new InvalidJsonBodyError();
    throw error;
  }
}
