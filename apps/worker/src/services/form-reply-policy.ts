export interface FormReplyPolicyInput {
  send_submit_message: number;
}

export function shouldSendFormReply(form: FormReplyPolicyInput): boolean {
  return form.send_submit_message !== 0;
}
