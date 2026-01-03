'use client';

import { NewsItem } from '@/lib/types';

interface SelectedQueueProps {
    items: NewsItem[];
    onRemove: (item: NewsItem) => void;
    onClear: () => void;
    onStartResearch: () => void;
}

export function SelectedQueue({ items, onRemove, onClear, onStartResearch }: SelectedQueueProps) {
    return (
        <div className="bg-gray-800/80 rounded-2xl border border-gray-700 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 bg-gradient-to-r from-purple-600/20 to-blue-600/20 border-b border-gray-700">
                <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-white flex items-center gap-2">
                        <span className="text-xl">📋</span>
                        Research Queue
                        <span className="ml-2 px-2 py-0.5 bg-purple-500 text-white text-xs rounded-full">
                            {items.length}
                        </span>
                    </h2>
                    {items.length > 0 && (
                        <button
                            onClick={onClear}
                            className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                        >
                            Clear all
                        </button>
                    )}
                </div>
            </div>

            {/* Queue items */}
            <div className="p-4 max-h-[400px] overflow-y-auto">
                {items.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <div className="text-4xl mb-3">🎯</div>
                        <p className="text-sm">Select news items to add to research queue</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {items.map((item, index) => (
                            <div
                                key={item.id}
                                className="flex items-center gap-3 p-3 bg-gray-900/50 rounded-lg group"
                            >
                                <span className="w-6 h-6 bg-purple-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                                    {index + 1}
                                </span>
                                <span className="flex-1 text-sm text-gray-300 line-clamp-1">
                                    {item.title}
                                </span>
                                <button
                                    onClick={() => onRemove(item)}
                                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Action button */}
            {items.length > 0 && (
                <div className="p-4 border-t border-gray-700">
                    <button
                        onClick={onStartResearch}
                        className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                        <span>🔬</span>
                        Start Deep Research
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                    </button>
                </div>
            )}
        </div>
    );
}
