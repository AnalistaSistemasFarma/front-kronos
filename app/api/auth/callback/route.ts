import axios from "axios";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const code = req.query.code as string;

  if (!code) return res.status(400).send("No auth code");

  try {
    const tokenResponse = await axios.post(
      `https://login.microsoftonline.com/${process.env.MICROSOFTTENANTID}/oauth2/v2.0/token`,
      new URLSearchParams({
        client_id: process.env.MICROSOFTCLIENTID!,
        scope: "https://graph.microsoft.com/.default offline_access",
        code,
        redirect_uri: "http://localhost:3003/api/auth/callback",
        grant_type: "authorization_code",
        client_secret: process.env.MICROSOFTCLIENTSECRET!,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const token = tokenResponse.data.access_token;
    // Opcional: guardar token en cookie o sesión
    res.redirect(`/dashboard?token=${token}`);
  } catch (error) {
    console.error("Token exchange failed:", error);
    res.status(500).send("Token exchange failed");
  }
}
 