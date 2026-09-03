export class StudioError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new StudioError('invalid_input', 'Expected an object.');
  return value as Record<string, unknown>;
}
export function string(value: unknown, name: string, max = 12000): string {
  if (typeof value !== 'string' || value.length > max)
    throw new StudioError(
      'invalid_input',
      `${name} must be text with at most ${max} characters.`,
    );
  return value;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new StudioError('invalid_id', 'Invalid Studio ID.');
  return value;
}
export function safeMessage(error: unknown): string {
  if (error instanceof StudioError) return error.message;
  return 'The operation could not be completed. Your saved work is retained.';
}
