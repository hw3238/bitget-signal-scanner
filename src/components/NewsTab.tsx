import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NEWS_FILTERS,
  NEWS_SOURCES,
  fetchNewsFeed,
  filterNews,
  mergeNews,
  newsAge,
  type NewsFeedResult,
  type NewsFilter,
  type NewsItem,
} from '../api/cryptoNews';
import { fmtTime } from '../lib/format';
import { openExternalUrl } from '../lib/native';
import { RefreshIcon } from './Icons';

/** 자동 갱신 주기 — 화면이 열려 있는 동안만 돈다 */
const POLL_MS = 60_000;
/** 요청 한도(429)에 걸린 피드는 이 시간 동안 건너뛴다 */
const COOLDOWN_MS = 5 * 60_000;
const MAX_SHOW = 80;
/** 누적 보관 상한 — 60초마다 새 기사가 붙어도 목록이 끝없이 길어지지 않게 */
const MAX_KEEP = 200;

interface FeedState {
  id: string;
  name: string;
  ok: boolean;
  at: number;
  error: string | null;
}

const TONE_LABEL: Record<string, string> = { good: '호재', bad: '악재' };

export function NewsTab() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [feeds, setFeeds] = useState<FeedState[]>(
    NEWS_SOURCES.map((s) => ({ id: s.id, name: s.name, ok: true, at: 0, error: null })),
  );
  const [filter, setFilter] = useState<NewsFilter>('all');
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const cooldown = useRef(new Map<string, number>());

  const load = useCallback(async (manual: boolean) => {
    const now = Date.now();
    const due = NEWS_SOURCES.filter((s) => manual || (cooldown.current.get(s.id) ?? 0) <= now);
    if (due.length === 0) return;
    setLoading(true);
    const results = await Promise.all(due.map((source) => fetchNewsFeed(source)));
    const fresh: NewsItem[] = [];
    for (const r of results) {
      if (r.ok) {
        fresh.push(...r.items);
        cooldown.current.delete(r.source.id);
      } else if (/한도/.test(r.error ?? '')) {
        cooldown.current.set(r.source.id, Date.now() + COOLDOWN_MS);
      }
    }
    setItems((prev) => mergeNews(prev, fresh).slice(0, MAX_KEEP));
    setFeeds((prev) => {
      const next = [...prev];
      for (const r of results as NewsFeedResult[]) {
        const i = next.findIndex((f) => f.id === r.source.id);
        const state: FeedState = { id: r.source.id, name: r.source.name, ok: r.ok, at: r.at, error: r.error };
        if (i >= 0) next[i] = state;
        else next.push(state);
      }
      return next;
    });
    setUpdatedAt((prev) => (fresh.length ? Date.now() : prev));
    setAttempted(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(false);
    const timer = setInterval(() => void load(false), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const visible = useMemo(() => filterNews(items, filter).slice(0, MAX_SHOW), [items, filter]);
  const failed = feeds.filter((f) => !f.ok);
  const allFailed = attempted && items.length === 0 && failed.length === feeds.length;
  const staleFeeds = items.length > 0 ? failed : [];

  return (
    <div className="tab news-tab" data-news-tab>
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">
              📰 실시간 코인 뉴스
              <span className={`tool-badge${allFailed ? ' down' : ''}`} data-news-count>
                {items.length}건
              </span>
            </div>
            <div className="summary-sub" data-news-status>
              {NEWS_SOURCES.length}개 피드 · 60초 자동 갱신 ·{' '}
              {updatedAt ? `${fmtTime(updatedAt)} 갱신` : loading ? '불러오는 중' : '대기'}
            </div>
          </div>
          <button
            type="button"
            className={`rescan ${loading ? 'busy' : ''}`}
            onClick={() => void load(true)}
            disabled={loading}
            data-news-refresh
          >
            <RefreshIcon size={15} />
            새로고침
          </button>
        </div>

        <div className="news-feeds" data-news-feeds>
          {feeds.map((f) => (
            <span key={f.id} className={`news-feed ${f.ok ? 'on' : 'off'}`} data-news-feed={f.id}>
              <i />
              {f.name}
              {!f.ok && <em>연결 실패</em>}
            </span>
          ))}
        </div>
      </section>

      {allFailed && (
        <section className="news-banner" data-news-error>
          <b>뉴스를 불러오지 못했습니다</b>
          <span>
            {failed[0]?.error ? `사유: ${failed[0].error}` : '네트워크 상태를 확인해 주세요.'} 잠시 뒤 자동으로 다시
            시도합니다.
          </span>
          <button type="button" className="ghost-btn small" onClick={() => void load(true)} disabled={loading}>
            <RefreshIcon size={13} /> 다시 시도
          </button>
        </section>
      )}

      {!allFailed && staleFeeds.length > 0 && (
        <section className="news-banner slim" data-news-partial>
          <span>
            {staleFeeds.map((f) => f.name).join(' · ')} 피드가 지금 응답하지 않아 나머지 피드로 보여 주는 중입니다.
          </span>
        </section>
      )}

      <div className="segmented news-filters" data-news-filters>
        {NEWS_FILTERS.map((f) => (
          <button
            key={f.key}
            className={filter === f.key ? 'on' : ''}
            onClick={() => setFilter(f.key)}
            data-news-filter={f.key}
          >
            {f.label}
          </button>
        ))}
      </div>

      <section className="news-list" data-news-list>
        {visible.length === 0 && (
          <div className="whale-empty" data-news-empty>
            <b>{allFailed ? '표시할 뉴스가 없습니다' : loading ? '뉴스를 불러오는 중입니다' : '해당 조건의 뉴스가 없습니다'}</b>
            <span>
              {filter === 'signal'
                ? '지금은 호재·악재 키워드가 붙은 기사가 없습니다. 전체로 보면 모든 기사가 나옵니다.'
                : '잠시 후 새로고침하거나 다른 필터를 눌러 보세요.'}
            </span>
          </div>
        )}
        {visible.map((item) => (
          <button
            type="button"
            className="news-item"
            key={item.id}
            onClick={() => void openExternalUrl(item.link)}
            data-news-item
            data-source={item.sourceId}
            data-tone={item.tone}
            title="원문 기사 열기"
          >
            <div className="news-meta">
              <span className={`news-source ${item.lang}`}>{item.source}</span>
              <span className="news-age">{newsAge(item.at)}</span>
              <span className="news-time">{item.at ? fmtTime(item.at) : ''}</span>
              {item.tone !== 'neutral' && (
                <span className={`news-tone ${item.tone}`}>{TONE_LABEL[item.tone]}</span>
              )}
              {item.macro && <span className="news-tone macro">거시</span>}
            </div>
            <b className="news-title">{item.title}</b>
            {item.summary && <p className="news-summary">{item.summary}</p>}
            {(item.coins.length > 0 || item.hits.length > 0) && (
              <div className="news-tags">
                {item.coins.map((c) => (
                  <span className="news-tag coin" key={c}>
                    {c}
                  </span>
                ))}
                {item.hits
                  .filter((h) => !item.coins.includes(h))
                  .slice(0, 2)
                  .map((h) => (
                    <span className="news-tag hit" key={h}>
                      {h}
                    </span>
                  ))}
              </div>
            )}
          </button>
        ))}
      </section>

      <div className="feed-note">
        기사 제목·요약은 각 뉴스사가 공개한 RSS 원문 그대로이며 COTA가 요약을 새로 쓰지 않습니다. 배지는 제목·본문의 키워드로
        자동 분류한 참고 표시입니다. 기사를 누르면 원문이 새 창에서 열립니다. 투자 권유가 아닙니다.
      </div>
    </div>
  );
}
