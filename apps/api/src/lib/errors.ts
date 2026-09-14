export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export function assert(condition: unknown, code: string, message: string, status = 400): asserts condition {
  if (!condition) throw new AppError(code, message, status);
}
