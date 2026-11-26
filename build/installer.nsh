!include LogicLib.nsh
!include nsDialogs.nsh
!include WinMessages.nsh
!include FileFunc.nsh

!ifndef BUILD_UNINSTALLER
  Var wbDialog
  Var wbCacheText
  Var wbCacheBrowse
  Var wbDataText
  Var wbDataBrowse
  Var wbDesktopCheckbox
  Var wbCacheDir
  Var wbDataDir
  Var wbDefaultDrive
  Var wbSystemDrive
  Var wbOnlySystemDrive
  Var wbExistingInstallDir
  Var wbExplicitInstallDir
  Var wbWantDesktopShortcut
  Var wbPathValue
  Var wbPathExpected
  Var wbPathParent
  Var wbPathLeaf
  Var wbPathLength
  Var wbPathIndex
  Var wbPathChar
  Var wbCandidate
  Var wbCandidateLength
  Var wbInstallLength
  Var wbPathPrefix
  Var wbShortcutIcon
!endif

!macro customPageAfterChangeDir
  !ifndef BUILD_UNINSTALLER
    Page custom WorkbenchPathsCreate WorkbenchPathsLeave
  !endif
!macroend

!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    !insertmacro setInstallModePerUser
    ${If} $wbExistingInstallDir == ""
    ${AndIf} $wbExplicitInstallDir == ""
      StrCpy $INSTDIR "$wbDefaultDrive\${APP_FILENAME}"
    ${EndIf}
    Abort
  !endif
!macroend

!macro customInit
  ReadRegStr $wbExistingInstallDir HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ReadRegStr $wbCacheDir HKCU "${INSTALL_REGISTRY_KEY}" "CacheDir"
  ReadRegStr $wbDataDir HKCU "${INSTALL_REGISTRY_KEY}" "DataDir"
  ReadRegStr $wbWantDesktopShortcut HKCU "${INSTALL_REGISTRY_KEY}" "DesktopShortcut"
  ${StdUtils.GetParameter} $wbExplicitInstallDir "D" ""

  Call WorkbenchSelectDefaultDrive
  ${If} $wbOnlySystemDrive == "1"
  ${AndIf} $wbExistingInstallDir == ""
    ${IfNot} ${Silent}
      MessageBox MB_ICONEXCLAMATION|MB_OK "未检测到非系统盘。你可以继续手动选择安装、缓存和数据目录；如选择 C 盘，安装程序仍会自动添加应用专属目录。"
    ${EndIf}
  ${EndIf}

  ${If} $wbCacheDir == ""
    StrCpy $wbCacheDir "$wbDefaultDrive\WorkbenchCache"
  ${EndIf}
  ${If} $wbDataDir == ""
    StrCpy $wbDataDir "$wbDefaultDrive\WorkbenchData"
  ${EndIf}
  ${If} $wbWantDesktopShortcut != "0"
    StrCpy $wbWantDesktopShortcut "1"
  ${EndIf}
!macroend

!macro customInstall
  CreateDirectory "$wbCacheDir"
  CreateDirectory "$wbDataDir"

  WriteINIStr "$INSTDIR\storage.ini" "Storage" "CacheDir" "$wbCacheDir"
  WriteINIStr "$INSTDIR\storage.ini" "Storage" "DataDir" "$wbDataDir"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "CacheDir" "$wbCacheDir"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "DataDir" "$wbDataDir"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "DesktopShortcut" "$wbWantDesktopShortcut"

  ${If} $wbWantDesktopShortcut == "1"
    StrCpy $wbShortcutIcon "$appExe"
    ${If} ${FileExists} "$INSTDIR\resources\icon.ico"
      StrCpy $wbShortcutIcon "$INSTDIR\resources\icon.ico"
    ${EndIf}
    CreateShortCut "$newDesktopLink" "$appExe" "" "$wbShortcutIcon" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${Else}
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ; 覆盖安装时资源管理器可能仍显示旧图标，主动重建一次图标缓存。
  nsExec::ExecToLog '"$SYSDIR\ie4uinit.exe" -show'
!macroend

!macro customUnInstall
  ${IfNot} ${isKeepShortcuts}
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
    ${If} $oldDesktopLink != $newDesktopLink
      WinShell::UninstShortcut "$oldDesktopLink"
      Delete "$oldDesktopLink"
    ${EndIf}
  ${EndIf}
!macroend

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Function WorkbenchDriveCallback
      ${If} $wbDefaultDrive == ""
        StrCpy $0 $9 2
        ${If} $0 != $wbSystemDrive
          StrCpy $wbDefaultDrive $0
          Push "StopGetDrives"
          Return
        ${EndIf}
      ${EndIf}
      Push ""
    FunctionEnd

    Function WorkbenchSelectDefaultDrive
      StrCpy $wbDefaultDrive ""
      StrCpy $wbOnlySystemDrive "0"
      ReadEnvStr $wbSystemDrive "SystemDrive"
      ${If} $wbSystemDrive == ""
        StrCpy $wbSystemDrive "C:"
      ${EndIf}

      ${GetDrives} "HDD" WorkbenchDriveCallback
      ${If} $wbDefaultDrive == ""
        StrCpy $wbDefaultDrive $wbSystemDrive
        StrCpy $wbOnlySystemDrive "1"
      ${EndIf}
    FunctionEnd

    ; 输入：$R0 为父目录或完整目录，$R1 为末级目录名；输出：$R0。
    Function WorkbenchNormalizePath
      StrCpy $wbPathValue $R0
      StrCpy $wbPathExpected $R1

      wb_trim_trailing:
        StrLen $wbPathLength $wbPathValue
        IntCmp $wbPathLength 3 wb_trim_done wb_trim_done
        StrCpy $wbPathChar $wbPathValue 1 -1
        ${If} $wbPathChar == "\"
        ${OrIf} $wbPathChar == "/"
          StrCpy $wbPathValue $wbPathValue -1
          Goto wb_trim_trailing
        ${EndIf}
      wb_trim_done:

      StrLen $wbPathLength $wbPathValue
      ${If} $wbPathLength == 2
        StrCpy $wbPathChar $wbPathValue 1 1
        ${If} $wbPathChar == ":"
          StrCpy $R0 "$wbPathValue\$wbPathExpected"
          Return
        ${EndIf}
      ${ElseIf} $wbPathLength == 3
        StrCpy $wbPathChar $wbPathValue 1 1
        ${If} $wbPathChar == ":"
          StrCpy $wbPathValue $wbPathValue 2
          StrCpy $R0 "$wbPathValue\$wbPathExpected"
          Return
        ${EndIf}
      ${EndIf}

      StrCpy $wbPathParent ""
      StrCpy $wbPathLeaf $wbPathValue
      StrLen $wbPathLength $wbPathValue
      IntOp $wbPathIndex $wbPathLength - 1

      wb_find_leaf:
        IntCmp $wbPathIndex 0 wb_compare_leaf wb_compare_leaf
        StrCpy $wbPathChar $wbPathValue 1 $wbPathIndex
        ${If} $wbPathChar == "\"
        ${OrIf} $wbPathChar == "/"
          IntOp $wbPathLength $wbPathIndex + 1
          StrCpy $wbPathLeaf $wbPathValue "" $wbPathLength
          StrCpy $wbPathParent $wbPathValue $wbPathIndex
          Goto wb_compare_leaf
        ${EndIf}
        IntOp $wbPathIndex $wbPathIndex - 1
        Goto wb_find_leaf

      wb_compare_leaf:
        System::Call 'kernel32::lstrcmpiW(w "$wbPathLeaf", w "$wbPathExpected")i.r0'
        ${If} $0 == 0
          ${If} $wbPathParent == ""
            StrCpy $R0 $wbPathExpected
          ${Else}
            StrCpy $R0 "$wbPathParent\$wbPathExpected"
          ${EndIf}
        ${Else}
          StrCpy $R0 "$wbPathValue\$wbPathExpected"
        ${EndIf}
    FunctionEnd

    ; 输入：$R0 为候选目录；输出：$R0=1 表示候选目录等于或位于安装目录内。
    Function WorkbenchIsWithinInstall
      StrCpy $wbCandidate $R0
      StrLen $wbCandidateLength $wbCandidate
      StrLen $wbInstallLength $INSTDIR
      StrCpy $wbPathPrefix $wbCandidate $wbInstallLength
      System::Call 'kernel32::lstrcmpiW(w "$wbPathPrefix", w "$INSTDIR")i.r0'
      ${If} $0 != 0
        StrCpy $R0 "0"
        Return
      ${EndIf}
      ${If} $wbCandidateLength == $wbInstallLength
        StrCpy $R0 "1"
        Return
      ${EndIf}
      ${If} $wbCandidateLength < $wbInstallLength
        StrCpy $R0 "0"
        Return
      ${EndIf}
      StrCpy $wbPathChar $wbCandidate 1 $wbInstallLength
      ${If} $wbPathChar == "\"
        StrCpy $R0 "1"
      ${Else}
        StrCpy $R0 "0"
      ${EndIf}
    FunctionEnd

    Function WorkbenchBrowseCache
      ${NSD_GetText} $wbCacheText $0
      nsDialogs::SelectFolderDialog "选择缓存父目录，将自动添加 WorkbenchCache" "$0"
      Pop $0
      ${If} $0 != "error"
        StrCpy $R0 $0
        StrCpy $R1 "WorkbenchCache"
        Call WorkbenchNormalizePath
        ${NSD_SetText} $wbCacheText $R0
      ${EndIf}
    FunctionEnd

    Function WorkbenchBrowseData
      ${NSD_GetText} $wbDataText $0
      nsDialogs::SelectFolderDialog "选择数据存储父目录，将自动添加 WorkbenchData" "$0"
      Pop $0
      ${If} $0 != "error"
        StrCpy $R0 $0
        StrCpy $R1 "WorkbenchData"
        Call WorkbenchNormalizePath
        ${NSD_SetText} $wbDataText $R0
      ${EndIf}
    FunctionEnd

    Function WorkbenchPathsCreate
      !insertmacro MUI_HEADER_TEXT "存储位置与快捷方式" "选择父目录后会自动添加应用专属目录。"
      StrCpy $R0 $INSTDIR
      StrCpy $R1 "${APP_FILENAME}"
      Call WorkbenchNormalizePath
      StrCpy $INSTDIR $R0

      nsDialogs::Create 1018
      Pop $wbDialog
      ${If} $wbDialog == "error"
        Abort
      ${EndIf}

      ${NSD_CreateLabel} 0 0 100% 12u "安装目录（已自动添加应用目录）："
      Pop $0
      ${NSD_CreateLabel} 0 12u 100% 20u "$INSTDIR"
      Pop $0

      ${NSD_CreateLabel} 0 38u 100% 12u "缓存目录："
      Pop $0
      ${NSD_CreateText} 0 51u 78% 12u "$wbCacheDir"
      Pop $wbCacheText
      ${NSD_CreateButton} 81% 50u 19% 14u "浏览..."
      Pop $wbCacheBrowse
      ${NSD_OnClick} $wbCacheBrowse WorkbenchBrowseCache

      ${NSD_CreateLabel} 0 72u 100% 12u "任务数据存储目录："
      Pop $0
      ${NSD_CreateText} 0 85u 78% 12u "$wbDataDir"
      Pop $wbDataText
      ${NSD_CreateButton} 81% 84u 19% 14u "浏览..."
      Pop $wbDataBrowse
      ${NSD_OnClick} $wbDataBrowse WorkbenchBrowseData

      ${NSD_CreateCheckbox} 0 111u 100% 12u "在桌面创建“个人工作台”快捷方式"
      Pop $wbDesktopCheckbox
      SendMessage $wbDesktopCheckbox ${BM_SETCHECK} $wbWantDesktopShortcut 0
      nsDialogs::Show
    FunctionEnd

    Function WorkbenchPathsLeave
      ${NSD_GetText} $wbCacheText $wbCacheDir
      ${NSD_GetText} $wbDataText $wbDataDir
      ${If} $wbCacheDir == ""
      ${OrIf} $wbDataDir == ""
        MessageBox MB_ICONEXCLAMATION|MB_OK "缓存目录和任务数据存储目录不能为空。"
        Abort
      ${EndIf}

      StrCpy $R0 $wbCacheDir
      StrCpy $R1 "WorkbenchCache"
      Call WorkbenchNormalizePath
      StrCpy $wbCacheDir $R0
      ${NSD_SetText} $wbCacheText $wbCacheDir

      StrCpy $R0 $wbDataDir
      StrCpy $R1 "WorkbenchData"
      Call WorkbenchNormalizePath
      StrCpy $wbDataDir $R0
      ${NSD_SetText} $wbDataText $wbDataDir

      System::Call 'kernel32::lstrcmpiW(w "$wbCacheDir", w "$wbDataDir")i.r0'
      ${If} $0 == 0
        MessageBox MB_ICONEXCLAMATION|MB_OK "缓存目录和任务数据存储目录不能相同，请分别选择。"
        Abort
      ${EndIf}

      StrCpy $R0 $wbCacheDir
      Call WorkbenchIsWithinInstall
      ${If} $R0 == "1"
        MessageBox MB_ICONEXCLAMATION|MB_OK "缓存目录不能放在安装目录内，否则卸载时会被一并删除。"
        Abort
      ${EndIf}
      StrCpy $R0 $wbDataDir
      Call WorkbenchIsWithinInstall
      ${If} $R0 == "1"
        MessageBox MB_ICONEXCLAMATION|MB_OK "任务数据存储目录不能放在安装目录内，否则卸载时会被一并删除。"
        Abort
      ${EndIf}

      SendMessage $wbDesktopCheckbox ${BM_GETCHECK} 0 0 $wbWantDesktopShortcut
    FunctionEnd
  !endif
!macroend
