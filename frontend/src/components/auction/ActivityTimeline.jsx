import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History } from 'lucide-react';
import api from '../../services/api';

const DOT_COLOURS = {
  CREATED: 'bg-gray-400',
  APPROVED: 'bg-blue-500',
  REJECTED: 'bg-red-500',
  BID_ACCEPTED: 'bg-[#ea7f61]',
  DEAL_LOCKED: 'bg-green-600',
  AUTO_SETTLED: 'bg-green-600',
  CLOSED_NO_BIDS: 'bg-gray-500',
  PAYMENT_CAPTURED: 'bg-emerald-600',
  PAYMENT_FAILED: 'bg-red-500',
};

/**
 * Audit trail of one auction (GET /auctions/:id/timeline). Only rendered for
 * the listing's farmer, the winning buyer and admins; the API enforces the
 * same rule.
 */
const ActivityTimeline = ({ auctionId, refreshKey }) => {
  const { t, i18n } = useTranslation();
  const [events, setEvents] = useState([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/auctions/${auctionId}/timeline`)
      .then(({ data }) => {
        if (!cancelled && data.success) setEvents(data.events);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [auctionId, refreshKey]);

  if (failed || events.length === 0) return null;

  const locale = i18n.language === 'hi' ? 'hi-IN' : 'en-IN';

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 border border-[#E5DED3]">
      <h3 className="flex items-center gap-2 text-lg font-bold text-[#2D2D2D] mb-4">
        <History className="w-5 h-5 text-[#ea7f61]" />
        {t('timeline.title')}
      </h3>
      <ol className="space-y-3">
        {events.map((event) => (
          <li key={event._id} className="flex items-start gap-3">
            <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${DOT_COLOURS[event.type] || 'bg-gray-400'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[#2D2D2D]">
                {t(`timeline.events.${event.type}`)}
                {event.data?.amount != null && (
                  <span className="ml-2 text-[#ea7f61]">₹{Number(event.data.amount).toLocaleString(locale)}</span>
                )}
              </p>
              <p className="text-xs text-[#6B6B6B]">
                {new Date(event.createdAt).toLocaleString(locale, {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
                {' · '}
                {event.actor?.name || t(`timeline.actors.${event.actorType}`)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
};

export default ActivityTimeline;
