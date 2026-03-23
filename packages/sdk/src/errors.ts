export class LineHarnessError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    super(message)
    this.name = 'LineHarnessError'
  }
}
