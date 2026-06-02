/**
 * Must load before any other main-process module so console/stdout EPIPE cannot
 * crash Electron when the app is not attached to a terminal.
 */
import { installMainProcessBrokenPipeGuard } from './main-console'

installMainProcessBrokenPipeGuard()
