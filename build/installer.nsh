; Vertal Launcher — NSIS custom setup page.
; Merges the app's first-run setup (data folder + offline profile) into the
; installer so the app opens ready to use — no second "installation".
;
; Hooked via electron-builder "nsis.include": customPageAfterChangeDir shows
; the page between directory selection and install; customInstall writes a
; small setup.ini that the app imports on its first launch.

!ifndef VERTAL_NSIS_EXTRA_INC
!define VERTAL_NSIS_EXTRA_INC

!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER

Var VertalSetupDlg
Var VertalDataDir
Var VertalDataDirCtrl
Var VertalUsername
Var VertalUsernameCtrl

!macro customInit
  ; Defaults first: even if the page cannot render (nsDialogs Abort), the
  ; values below are captured and setup.ini is still written with them.
  StrCpy $VertalDataDir "$APPDATA\Vertal Launcher\data"
  StrCpy $VertalUsername ""
!macroend

!macro customPageAfterChangeDir
  Page custom fnVertalSetupCreate fnVertalSetupLeave
!macroend

Function fnVertalSetupCreate
  nsDialogs::Create 1018
  Pop $VertalSetupDlg
  ${If} $VertalSetupDlg == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 22u "Vertal Setup"
  Pop $0
  ${NSD_CreateLabel} 0 22u 100% 12u "Choose where game files live and an optional offline profile name."
  Pop $0

  ${NSD_CreateLabel} 0 44u 100% 12u "Data folder (Minecraft versions, libraries, worlds):"
  Pop $0

  ${NSD_CreateDirRequest} 0 58u 78% 12u "$APPDATA\Vertal Launcher\data"
  Pop $VertalDataDirCtrl

  ${NSD_CreateBrowseButton} 81% 58u 19% 12u "Browse..."
  Pop $0
  ${NSD_OnClick} $0 fnVertalBrowseData

  ${NSD_CreateLabel} 0 80u 100% 12u "Offline profile name (optional — add more later in Settings):"
  Pop $0

  ${NSD_CreateText} 0 94u 100% 12u ""
  Pop $VertalUsernameCtrl

  nsDialogs::Show
FunctionEnd

Function fnVertalBrowseData
  ${NSD_GetText} $VertalDataDirCtrl $0
  nsDialogs::SelectFolderDialog "Choose Vertal data folder" "$0"
  Pop $0
  ${If} $0 != error
    ${NSD_SetText} $VertalDataDirCtrl $0
  ${EndIf}
FunctionEnd

Function fnVertalSetupLeave
  ${NSD_GetText} $VertalDataDirCtrl $VertalDataDir
  ${NSD_GetText} $VertalUsernameCtrl $VertalUsername
FunctionEnd

!endif ; !ifndef BUILD_UNINSTALLER

!macro customInstall
  ; Persist the choices for the app to import on first launch. On
  ; reinstall/upgrade an existing setup.ini must NOT be overwritten —
  ; otherwise the user's data-root/profile choices would reset (the app
  ; side also refuses to override an existing customDataRoot).
  IfFileExists "$APPDATA\Vertal Launcher\setup.ini" +5
  CreateDirectory "$APPDATA\Vertal Launcher"
  FileOpen $0 "$APPDATA\Vertal Launcher\setup.ini" w
  FileWrite $0 "dataRoot=$VertalDataDir$\r$\n"
  FileWrite $0 "username=$VertalUsername$\r$\n"
  FileClose $0
!macroend

!endif