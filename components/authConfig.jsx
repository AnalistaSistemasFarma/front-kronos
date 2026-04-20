import { PublicClientApplication } from "@azure/msal-browser";

const msalConfig = {
  auth: {
    clientId: `${process.env.MICROSOFTCLIENTID}`,
    authority: `https://login.microsoftonline.com/${process.env.MICROSOFTTENANTID}`,
    redirectUri: `${process.env.MICROSOFTURI}`,
  },
};

const msalInstance = new PublicClientApplication(msalConfig);

export default msalInstance;
