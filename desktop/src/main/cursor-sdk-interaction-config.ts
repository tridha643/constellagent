import { configureCursorSdkRipgrep } from './cursor-sdk-ripgrep'
import { installCursorSdkAskQuestionHook } from './agents/cursor-sdk-interaction-patch'

configureCursorSdkRipgrep()
installCursorSdkAskQuestionHook()
