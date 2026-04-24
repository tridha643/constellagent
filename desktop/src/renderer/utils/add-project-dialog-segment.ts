/** Dispatched on `window` when Add Project is open; matches global app tab-switch chords. */
export const ADD_PROJECT_DIALOG_SEGMENT = 'constellagent:add-project-dialog:segment' as const

export type AddProjectDialogSegmentDetail = { direction: 'back' | 'forward' }
