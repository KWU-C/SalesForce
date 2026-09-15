interface SectionBannerProps {
  children: React.ReactNode;
  /** 見出しの右側に添える補助コンテンツ(例: 月次資金収支の「この月をfreeeから更新」ボタン) */
  right?: React.ReactNode;
}

/**
 * 経営ダッシュボードの各セクション見出し用の帯(ユーザー確定、2026-09-15)。
 * 経営サマリー/支出構成/月次資金収支/借入状況/資金の備え/当期累計で共通利用する。
 */
export function SectionBanner({ children, right }: SectionBannerProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-[var(--band-bg)] px-3 py-2">
      <h2 className="text-base font-bold text-white">{children}</h2>
      {right}
    </div>
  );
}
