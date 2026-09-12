' HelderLabs ERP — arranque silencioso
'
' O atalho do Ambiente de Trabalho aponta para aqui. O único propósito deste
' ficheiro é correr o launcher SEM abrir uma janela de consola preta — que é a
' diferença entre parecer uma aplicação e parecer um script.
'
' O trabalho real está em launcher.mjs.

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = scriptDir & "\launcher.mjs"

If Not fso.FileExists(launcher) Then
  MsgBox "Instalacao incompleta: nao foi encontrado launcher.mjs em" & vbCrLf & scriptDir, 16, "HelderLabs ERP"
  WScript.Quit 1
End If

nodeExe = "node"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then
  nodeExe = "C:\Program Files\nodejs\node.exe"
End If

' 0 = janela oculta, False = nao esperar
On Error Resume Next
shell.Run """" & nodeExe & """ """ & launcher & """", 0, False

If Err.Number <> 0 Then
  MsgBox "Nao foi possivel arrancar o HelderLabs ERP." & vbCrLf & vbCrLf & _
         "Verifica se o Node.js esta instalado:" & vbCrLf & _
         "https://nodejs.org" & vbCrLf & vbCrLf & _
         "Detalhe: " & Err.Description, 16, "HelderLabs ERP"
  WScript.Quit 1
End If
