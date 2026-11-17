import { defineHandler } from "nitro";
import { setResponseHeader } from "nitro/h3";
import { getCloudPublicConfig } from "../../../utils/cloud-public-config";

export default defineHandler(event => {
  setResponseHeader(event, "Cache-Control", "no-store");
  return getCloudPublicConfig();
});
