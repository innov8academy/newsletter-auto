# Newsletter Wizard Implementation

## Phase 1: Core Infrastructure
- [/] Create `WizardContext.tsx` for state management
- [ ] Create `StepIndicator.tsx` component
- [ ] Update `StoryBlock` interface - ADD `l8rsTake` field

## Phase 2: Prompt Fixes
- [ ] Add date injection to `generate-section/route.ts`
- [ ] Fix section-specific prompts (no leakage)
- [ ] Add "L8R's Take" to story template

## Phase 3: UI Implementation
- [ ] Refactor `draft/page.tsx` with wizard flow
- [ ] Add step navigation (Back/Next)
- [ ] Test persistence on page refresh

## Phase 4: Polish
- [ ] Add regenerate button per section
- [ ] Add inline editing
- [ ] Smooth transitions between steps
