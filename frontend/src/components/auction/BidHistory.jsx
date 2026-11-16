import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gavel } from 'lucide-react';
import api from '../../services/api';

/**
 * Bid history of an auction (GET /auctions/:id/bids), highest first.
 * `refreshKey` changes whenever a new bid arrives, which refetches the list.
 */
const BidHistory = ({ auctionId, refreshKey }) => {
  const { t, i18n } = useTranslation();
  const [bids, setBids] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/auctions/${auctionId}/bids`)
      .then(({ data }) => {
        if (!cancelled && data.success) setBids(data.bids);
      })
      .catch((error) => console.error('Error fetching bids:', error));
    return () => {
      cancelled = true;
    };
  }, [auctionId, refreshKey]);

  const locale = i18n.language === 'hi' ? 'hi-IN' : 'en-IN';

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 border border-[#E5DED3]">
      <h3 className="flex items-center gap-2 text-lg font-bold text-[#2D2D2D] mb-4">
        <Gavel className="w-5 h-5 text-[#ea7f61]" />
        {t('bidHistory.title', { count: bids.length })}
      </h3>

      {bids.length === 0 ? (
        <p className="text-sm text-[#6B6B6B]">{t('bidHistory.empty')}</p>
      ) : (
        <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {bids.map((bid, index) => (
            <li
              key={bid._id}
              className={`flex items-center justify-between rounded-xl px-4 py-2.5 border ${
                index === 0 ? 'bg-green-50 border-green-200' : 'bg-[#F5F2ED] border-[#E5DED3]'
              }`}
            >
              <div>
                <p className="text-sm font-bold text-[#2D2D2D]">
                  {bid.bidder?.name}
                  {index === 0 && (
                    <span className="ml-2 text-xs bg-green-600 text-white px-2 py-0.5 rounded-full">
                      {t('bidHistory.highest')}
                    </span>
                  )}
                </p>
                <p className="text-xs text-[#6B6B6B]">
                  {new Date(bid.createdAt).toLocaleString(locale, {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </p>
              </div>
              <p className={`text-lg font-bold ${index === 0 ? 'text-green-600' : 'text-[#2D2D2D]'}`}>
                ₹{Number(bid.amount).toLocaleString(locale)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default BidHistory;
