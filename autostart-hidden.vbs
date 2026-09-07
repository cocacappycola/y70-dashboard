' ===========================================================================
'  Y70 Dashboard auto-start helper.
'
'  Waits for Windows to settle, then runs launch-dashboard.bat with no visible
'  console window. Installed into the Startup folder by install-autostart.bat.
'
'  Optional argument = delay in seconds (default 30). Handy for testing:
'      wscript autostart-hidden.vbs 0
' ===========================================================================
Option Explicit

Dim shell, fso, here, bat, delaySec

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

delaySec = 30
If WScript.Arguments.Count > 0 Then
  If IsNumeric(WScript.Arguments(0)) Then delaySec = CInt(WScript.Arguments(0))
End If

here = fso.GetParentFolderName(WScript.ScriptFullName)
bat = here & "\launch-dashboard.bat"

If Not fso.FileExists(bat) Then WScript.Quit 1

' Let the rest of startup finish first so the dashboard comes up without
' competing for disk/CPU — this is the "boot settle" period.
If delaySec > 0 Then WScript.Sleep delaySec * 1000

' 0 = hidden window, False = don't block.
shell.Run """" & bat & """ /quiet", 0, False
