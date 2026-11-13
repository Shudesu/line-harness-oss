export class LineHarnessError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
    /** Machine-readable API conflict reason, when supplied. */
    public readonly code?: string,
    /** An unknown LINE delivery must be checked before sending again. */
    public readonly requiresReview?: boolean,
  ) {
    super(message)
    this.name = 'LineHarnessError'
  }
}
