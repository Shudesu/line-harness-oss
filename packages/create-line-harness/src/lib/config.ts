export interface DeployConfig {
  // LINE credentials (from user input)
  lineChannelAccessToken: string;
  lineChannelSecret: string;
  lineLoginChannelId: string;

  // Generated during setup
  apiKey: string;
  d1DatabaseId: string;
  d1DatabaseName: string;
  workerName: string;
  workerUrl: string;
  adminProjectName: string;
  adminUrl: string;
  liffProjectName: string;
  liffUrl: string;
}
