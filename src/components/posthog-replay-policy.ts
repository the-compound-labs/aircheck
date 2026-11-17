/* Session replay stays off. A build that wants it sets enabled, the project key and host, and its own
 * sampling limits here; configureReplay() refuses any key or host that does not match. */
export const replayPolicy = {
  "version": 1,
  "enabled": false,
  "projectToken": "",
  "apiHost": "",
  "billing": {
    "verified": false,
    "plan": "",
    "hasActiveSubscription": false,
    "replaySubscribed": false,
    "freeRecordingLimit": 0,
    "boundary": ""
  },
  "sampleRate": 0,
  "maxSessionSeconds": 120,
  "maxOriginBrowserDaySeconds": 300
};
