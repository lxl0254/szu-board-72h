$baseUrl = if ($env:OLLAMA_BASE_URL) {
  $env:OLLAMA_BASE_URL
} else {
  "http://127.0.0.1:11434/v1"
}
$apiBase = $baseUrl -replace "/v1/?$", ""
$modelName = if ($env:OLLAMA_MODEL) {
  $env:OLLAMA_MODEL
} else {
  "deepseek-r1:1.5b"
}

try {
  $models = (Invoke-RestMethod -Uri "$apiBase/api/tags" -TimeoutSec 5).models
  $matched = $false
  foreach ($model in $models) {
    if ($model.name -eq $modelName) {
      $matched = $true
    }
  }

  if ($matched) {
    Write-Output "DeepSeek 模型已就绪：$modelName"
    $messages = @(
      @{
        role = "system"
        content = "Summarize the core event in one short sentence."
      },
      @{
        role = "user"
        content = "Students must submit scholarship applications by September 30."
      }
    )
    $body = ConvertTo-Json @{
      model = $modelName
      messages = $messages
      temperature = 0.1
    } -Depth 8
    $response = Invoke-RestMethod `
      -Method Post `
      -Uri "$baseUrl/chat/completions" `
      -ContentType "application/json" `
      -Body $body `
      -TimeoutSec 180
    Write-Output $response.choices[0].message.content
  } else {
    Write-Output "Ollama 正在运行，但尚未安装模型：$modelName"
  }
} catch {
  Write-Output "Ollama 尚未运行，安装后请执行：ollama pull $modelName"
}
