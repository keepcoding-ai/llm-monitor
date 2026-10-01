' Hidden launcher for bin/llm-monitor (Win+R and login). Optional arg: --no-open
Option Explicit
Dim sh, fso, here, bash, cmd, arg, pf, cands, c
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
bash = ""
cands = Array(sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Git\bin\bash.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Git\bin\bash.exe", _
  sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Git\bin\bash.exe")
For Each c In cands
  If bash = "" Then If fso.FileExists(c) Then bash = c
Next
If bash = "" Then
  MsgBox "Git Bash not found. Install Git for Windows.", 16, "LLM Monitor"
  WScript.Quit 1
End If
arg = ""
If WScript.Arguments.Count > 0 Then arg = " " & WScript.Arguments(0)
cmd = """" & bash & """ """ & here & "\llm-monitor""" & arg
sh.Run cmd, 0, False
