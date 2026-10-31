import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isPreReleaseEnabled, isPreReleasePath, isRetiredDeployment } from "@/config/deployEnvironment";

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
  const { pathname } = request.nextUrl;

  // 本番未公開の機能(PRE_RELEASE_PATHS)は、dev・ローカル以外では届かないようにする。
  // ページは営業進捗へ戻し、APIは404(Salesforce・Firestoreに到達させない)
  if (!isPreReleaseEnabled() && isPreReleasePath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!isRetiredDeployment()) return NextResponse.next();

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
