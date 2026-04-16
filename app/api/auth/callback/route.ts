import axios from "axios";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "No auth code" }, { status: 400 });
  }

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

    return NextResponse.redirect(
      `http://localhost:3003/dashboard?token=${token}`
    );
  } catch (error) {
    console.error("Token exchange failed:", error);
    return NextResponse.json(
      { error: "Token exchange failed" },
      { status: 500 }
    );
  }
}