' Abre o Gubots sem janela de terminal: o node roda num console oculto e os filhos
' (claude, codex, chrome, graphify) herdam esse console oculto, entao nunca abrem janelas.
' Com o argumento "restart" (usado pelo proprio Gubots ao se atualizar): espera o servidor antigo sair e nao abre o navegador.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
restart = WScript.Arguments.Count > 0
If restart Then WScript.Sleep 4000
sh.Run "cmd /c node --no-warnings server\index.ts >> data\server.log 2>&1", 0, False
If Not restart Then
  WScript.Sleep 2000
  sh.Run "http://127.0.0.1:8787"
End If
