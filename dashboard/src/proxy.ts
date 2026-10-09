import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isRetiredDeployment } from "@/config/deployEnvironment";

const MOVED_PATH = "/moved";

/**
 * 廃止済みURL(旧dev環境)へのアクセスを、本番URLへの案内ページに差し替える。
 * それ以外の環境(本番・現行dev・ローカル)では何もしない。
 *
 * ページはURLを変えずに/movedの内容を返す(rewrite)。古いブックマークのどのパスを
 * 開いても同じ案内が出る。APIは410を返し、Salesforce・freee・Firestoreのいずれにも
 * 到達させない(廃止済みURLからデータを読み書きできる状態を残さない)。
 */
export function proxy(request: NextRequest) {
  if (!isRetiredDeployment()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "gone" }, { status: 410 });
  }
  if (pathname === MOVED_PATH) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = MOVED_PATH;
  url.search = "";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
