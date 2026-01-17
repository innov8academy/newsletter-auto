'use client';

import React from 'react';
import { WIZARD_STEPS, useWizard } from '@/context/WizardContext';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StepIndicatorProps {
    className?: string;
    showLabels?: boolean;
}

export function StepIndicator({ className, showLabels = true }: StepIndicatorProps) {
    const { currentStep, isStepComplete, goToStep, selectedReports } = useWizard();

    // For the stories step, show sub-progress
    const storiesStep = WIZARD_STEPS.findIndex(s => s.id === 'stories');

    return (
        <div className={cn("w-full", className)}>
            {/* Progress bar background */}
            <div className="relative">
                <div className="absolute top-4 left-0 right-0 h-0.5 bg-white/10" />
                <div
                    className="absolute top-4 left-0 h-0.5 bg-gradient-to-r from-amber-400 to-coral-500 transition-all duration-500"
                    style={{
                        width: `${(currentStep / (WIZARD_STEPS.length - 1)) * 100}%`,
                    }}
                />

                {/* Step indicators */}
                <div className="relative flex justify-between">
                    {WIZARD_STEPS.map((step, index) => {
                        const isComplete = isStepComplete(index);
                        const isCurrent = index === currentStep;
                        const isPast = index < currentStep;
                        const isClickable = isPast || (index === currentStep);

                        // Special case: Stories step shows story count
                        const isStoriesStep = step.id === 'stories';
                        const storyCount = selectedReports.length;

                        return (
                            <button
                                key={step.id}
                                onClick={() => isClickable && goToStep(index)}
                                disabled={!isClickable}
                                className={cn(
                                    "flex flex-col items-center group transition-all",
                                    isClickable ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                                )}
                            >
                                {/* Circle */}
                                <div
                                    className={cn(
                                        "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 border-2",
                                        isComplete && isPast
                                            ? "bg-teal-500 border-teal-500 text-white"
                                            : isCurrent
                                                ? "bg-gradient-to-br from-amber-500 to-coral-500 border-amber-400 text-white shadow-glow-amber"
                                                : "bg-surface border-white/20 text-white/40"
                                    )}
                                >
                                    {isComplete && isPast ? (
                                        <Check className="w-4 h-4" />
                                    ) : isStoriesStep && storyCount > 0 ? (
                                        <span className="text-xs">{storyCount}</span>
                                    ) : (
                                        <span>{index + 1}</span>
                                    )}
                                </div>

                                {/* Label */}
                                {showLabels && (
                                    <div className="mt-2 text-center">
                                        <p
                                            className={cn(
                                                "text-xs font-medium transition-colors",
                                                isCurrent
                                                    ? "text-amber-400"
                                                    : isPast
                                                        ? "text-teal-400"
                                                        : "text-white/40"
                                            )}
                                        >
                                            {step.label}
                                        </p>
                                        {isCurrent && (
                                            <p className="text-[10px] text-white/30 mt-0.5">
                                                {step.description}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

// Compact version for mobile/narrow layouts
export function StepIndicatorCompact({ className }: { className?: string }) {
    const { currentStep, getProgress } = useWizard();
    const { percentage } = getProgress();
    const current = WIZARD_STEPS[currentStep];

    return (
        <div className={cn("flex items-center gap-3", className)}>
            {/* Progress circle */}
            <div className="relative w-10 h-10">
                <svg className="w-10 h-10 -rotate-90">
                    <circle
                        cx="20"
                        cy="20"
                        r="16"
                        stroke="currentColor"
                        strokeWidth="3"
                        fill="none"
                        className="text-white/10"
                    />
                    <circle
                        cx="20"
                        cy="20"
                        r="16"
                        stroke="url(#progress-gradient)"
                        strokeWidth="3"
                        fill="none"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 16}`}
                        strokeDashoffset={`${2 * Math.PI * 16 * (1 - percentage / 100)}`}
                        className="transition-all duration-500"
                    />
                    <defs>
                        <linearGradient id="progress-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#f59e0b" />
                            <stop offset="100%" stopColor="#f97316" />
                        </linearGradient>
                    </defs>
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                    {currentStep + 1}
                </span>
            </div>

            {/* Step info */}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                    {current.label}
                </p>
                <p className="text-xs text-white/40 truncate">
                    {current.description}
                </p>
            </div>

            {/* Percentage */}
            <span className="text-sm font-mono text-amber-400">
                {percentage}%
            </span>
        </div>
    );
}

// Navigation buttons component
interface WizardNavigationProps {
    onNext?: () => void;
    onBack?: () => void;
    nextLabel?: string;
    backLabel?: string;
    isNextLoading?: boolean;
    isNextDisabled?: boolean;
    showBack?: boolean;
    className?: string;
}

export function WizardNavigation({
    onNext,
    onBack,
    nextLabel = 'Continue',
    backLabel = 'Back',
    isNextLoading = false,
    isNextDisabled = false,
    showBack = true,
    className,
}: WizardNavigationProps) {
    const { prevStep, nextStep, canGoBack, canGoNext, isGenerating } = useWizard();

    const handleBack = onBack || prevStep;
    const handleNext = onNext || nextStep;

    return (
        <div className={cn("flex items-center justify-between pt-4 border-t border-white/5", className)}>
            {showBack && canGoBack ? (
                <button
                    onClick={handleBack}
                    disabled={isGenerating}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-white/50 hover:text-white hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50"
                >
                    <ChevronRight className="w-4 h-4 rotate-180" />
                    {backLabel}
                </button>
            ) : (
                <div /> // Spacer
            )}

            <button
                onClick={handleNext}
                disabled={isNextDisabled || isNextLoading || isGenerating}
                className={cn(
                    "flex items-center gap-2 px-6 py-2.5 rounded-xl font-medium text-sm transition-all",
                    "bg-gradient-to-r from-amber-500 to-coral-500 text-[#0B0B0F]",
                    "hover:from-amber-400 hover:to-coral-400",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    "shadow-glow-amber"
                )}
            >
                {isNextLoading ? (
                    <>
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        Generating...
                    </>
                ) : (
                    <>
                        {nextLabel}
                        <ChevronRight className="w-4 h-4" />
                    </>
                )}
            </button>
        </div>
    );
}
