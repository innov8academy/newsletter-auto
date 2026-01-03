'use client';

import { useState, useEffect } from 'react';
import { getCostSummary, clearCosts, getProfitStatus, CostSource } from '@/lib/cost-tracker';
import { DollarSign, TrendingUp, TrendingDown, Trash2, ChevronUp, ChevronDown } from 'lucide-react';

// Source display names
const SOURCE_LABELS: Record<CostSource, string> = {
    'curate': 'Curation',
    'research': 'Research',
    'enhance': 'Enhance',
    'draft': 'Draft',
    'regen-section': 'Section Regen',
    'regen-story': 'Story Regen',
    'image-prompt': 'Image Prompt',
    'image-gen': 'Image Gen',
};

export function CostTracker() {
    const [summary, setSummary] = useState<ReturnType<typeof getCostSummary> | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [targetEarnings] = useState(12.50); // $10-15 average

    // Load costs on mount and listen for updates
    useEffect(() => {
        const loadCosts = () => {
            setSummary(getCostSummary());
        };

        loadCosts();

        // Listen for cost updates
        window.addEventListener('costUpdated', loadCosts);
        return () => window.removeEventListener('costUpdated', loadCosts);
    }, []);

    if (!summary) return null;

    const profitStatus = getProfitStatus(summary.total, targetEarnings);

    // Color coding based on status
    const statusColors = {
        'profitable': {
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/30',
            text: 'text-emerald-400',
            icon: TrendingUp,
        },
        'warning': {
            bg: 'bg-amber-500/10',
            border: 'border-amber-500/30',
            text: 'text-amber-400',
            icon: TrendingUp,
        },
        'over-budget': {
            bg: 'bg-red-500/10',
            border: 'border-red-500/30',
            text: 'text-red-400',
            icon: TrendingDown,
        },
    };

    const colors = statusColors[profitStatus.status];
    const StatusIcon = colors.icon;

    const handleClear = () => {
        if (confirm('Clear all session costs? This cannot be undone.')) {
            clearCosts();
        }
    };

    // Get active sources (those with costs > 0)
    const activeSources = Object.entries(summary.bySource)
        .filter(([, cost]) => cost > 0)
        .sort((a, b) => b[1] - a[1]);

    return (
        <div className={`fixed bottom-0 left-0 right-0 z-50 ${colors.bg} border-t ${colors.border} backdrop-blur-xl`}>
            {/* Collapsed Bar */}
            <div
                className="container mx-auto px-4 py-2 flex items-center justify-between cursor-pointer"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <DollarSign className={`w-4 h-4 ${colors.text}`} />
                        <span className="text-sm font-medium text-white/80">Session Cost:</span>
                        <span className={`font-mono font-bold ${colors.text}`}>
                            ${summary.total.toFixed(4)}
                        </span>
                    </div>

                    <div className="hidden sm:flex items-center gap-2 text-white/50 text-sm">
                        <StatusIcon className={`w-4 h-4 ${colors.text}`} />
                        <span>
                            {profitStatus.status === 'over-budget'
                                ? `Over by $${Math.abs(profitStatus.margin).toFixed(2)}`
                                : `$${profitStatus.margin.toFixed(2)} margin`
                            }
                        </span>
                        <span className="text-white/30">|</span>
                        <span>{profitStatus.percentage.toFixed(1)}% of target</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleClear();
                        }}
                        className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors"
                        title="Clear Session"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                    {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-white/40" />
                    ) : (
                        <ChevronUp className="w-4 h-4 text-white/40" />
                    )}
                </div>
            </div>

            {/* Expanded Details */}
            {isExpanded && (
                <div className="container mx-auto px-4 pb-3 border-t border-white/10">
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 pt-3">
                        {activeSources.map(([source, cost]) => (
                            <div
                                key={source}
                                className="bg-white/5 rounded-lg px-3 py-2 text-center"
                            >
                                <div className="text-xs text-white/50 truncate">
                                    {SOURCE_LABELS[source as CostSource]}
                                </div>
                                <div className="font-mono text-sm text-white/80">
                                    ${cost.toFixed(4)}
                                </div>
                            </div>
                        ))}
                        {activeSources.length === 0 && (
                            <div className="col-span-full text-center text-white/40 text-sm py-2">
                                No costs tracked yet. Start using the app to see cost breakdown.
                            </div>
                        )}
                    </div>

                    {/* Recent entries */}
                    {summary.entries.length > 0 && (
                        <div className="mt-3 max-h-32 overflow-y-auto">
                            <div className="text-xs text-white/40 mb-1">Recent API Calls</div>
                            <div className="space-y-1">
                                {summary.entries.slice(-5).reverse().map((entry) => (
                                    <div
                                        key={entry.id}
                                        className="flex items-center justify-between text-xs bg-white/5 rounded px-2 py-1"
                                    >
                                        <span className="text-white/60 truncate flex-1">
                                            {entry.description}
                                        </span>
                                        <span className="text-white/40 mx-2 hidden sm:inline">
                                            {entry.model.split('/').pop()}
                                        </span>
                                        <span className="font-mono text-white/80">
                                            ${entry.cost.toFixed(4)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
