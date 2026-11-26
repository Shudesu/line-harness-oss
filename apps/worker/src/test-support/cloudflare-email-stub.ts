/** Unit-test envelope only; no delivery capability. */
export class EmailMessage {
  constructor(
    public from: string,
    public to: string,
    public raw: string,
  ) {}
}
