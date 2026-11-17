import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/* Every Aircheck page is force-dynamic and reads the signed-in account, so there is nothing to
 * hold in an incremental cache. */
export default defineCloudflareConfig({});
