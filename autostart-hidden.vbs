' ===========================================================================
'  Y70 Dashboard auto-start helper.
'
'  Waits for Windows to settle, then runs launch-dashboard.bat with no visible
'  console window. Installed into the Startup folder by install-autostart.bat.
'
'  Arg 1 = delay in seconds (default 30). Handy for testing:
'      wscript autostart-hidden.vbs 0
'  Arg 2 = which launcher, "v1" or "v2" (default v2 when it is installed).
'      wscript autostart-hidden.vbs 0 v1
' ===========================================================================
Option Explicit

Dim shell, fso, here, bat, delaySec, which

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

delaySec = 30
If WScript.Arguments.Count > 0 Then
  If IsNumeric(WScript.Arguments(0)) Then delaySec = CInt(WScript.Arguments(0))
End If

which = ""
If WScript.Arguments.Count > 1 Then which = LCase(WScript.Arguments(1))

here = fso.GetParentFolderName(WScript.ScriptFullName)

' Prefer the native V2 app when it has been installed, since it is the one that
' does not steal focus. Fall back to the V1 browser launcher otherwise.
If which = "v1" Then
  bat = here & "\launch-dashboard.bat"
ElseIf which = "v2" Then
  bat = here & "\launch-v2.bat"
ElseIf fso.FileExists(here & "\v2\node_modules\electron\dist\electron.exe") Then
  bat = here & "\launch-v2.bat"
Else
  bat = here & "\launch-dashboard.bat"
End If

If Not fso.FileExists(bat) Then WScript.Quit 1

' Let the rest of startup finish first so the dashboard comes up without
' competing for disk/CPU — this is the "boot settle" period.
If delaySec > 0 Then WScript.Sleep delaySec * 1000

' 0 = hidden window, False = don't block.
shell.Run """" & bat & """ /quiet", 0, False
