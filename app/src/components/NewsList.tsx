'use client';

import { NewsItem } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';

interface NewsCardProps {
    item: NewsItem;
    isSelected: boolean;
    onSelect: (item: NewsItem) => void;
}

export function NewsCard({ item, isSelected, onSelect }: NewsCardProps) {
    return (
        <div
            onClick={() => onSelect(item)}
            className={`
        p-4 rounded-xl border-2 cursor-pointer transition-all duration-200
        ${isSelected
                    ? 'border-purple-500 bg-purple-500/10 shadow-lg shadow-purple-500/20'
                    : 'border-gray-700 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800'
                }
      `}
        >
            <div className="flex items-start gap-3">
                {/* Selection indicator */}
                <div className={`
          w-5 h-5 rounded-full border-2 flex-shrink-0 mt-1
          flex items-center justify-center
          ${isSelected
                        ? 'border-purple-500 bg-purple-500'
                        : 'border-gray-600'
                    }
        `}>
                    {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white text-sm leading-tight line-clamp-2">
                        {item.title}
                    </h3>

                    {item.summary && (
                        <p className="text-gray-400 text-xs mt-2 line-clamp-2">
                            {item.summary}
                        </p>
                    )}

                    <div className="flex items-center gap-2 mt-3 text-xs text-gray-500">
                        <span className="px-2 py-0.5 bg-gray-700 rounded-full">
                            {item.sourceName}
                        </span>
                        <span>•</span>
                        <span>
                            {formatDistanceToNow(new Date(item.publishedAt), { addSuffix: true })}
                        </span>
                    </div>
                </div>

                {/* External link */}
                <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-gray-500 hover:text-purple-400 transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                </a>
            </div>
        </div>
    );
}

interface NewsListProps {
    items: NewsItem[];
    selectedIds: Set<string>;
    onSelect: (item: NewsItem) => void;
    loading?: boolean;
}

export function NewsList({ items, selectedIds, onSelect, loading }: NewsListProps) {
    if (loading) {
        return (
            <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="animate-pulse p-4 rounded-xl bg-gray-800/50 border border-gray-700">
                        <div className="flex gap-3">
                            <div className="w-5 h-5 rounded-full bg-gray-700" />
                            <div className="flex-1 space-y-2">
                                <div className="h-4 bg-gray-700 rounded w-3/4" />
                                <div className="h-3 bg-gray-700 rounded w-1/2" />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="text-center py-12 text-gray-500">
                <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                </svg>
                <p>No news items found</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {items.map((item) => (
                <NewsCard
                    key={item.id}
                    item={item}
                    isSelected={selectedIds.has(item.id)}
                    onSelect={onSelect}
                />
            ))}
        </div>
    );
}
