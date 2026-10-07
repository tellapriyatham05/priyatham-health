# A throwaway window used as the ONLY place tests type into.
# Its text box content is mirrored to a file so the test can read it back.
param([string]$OutFile)
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Jarvis Test Target'
$form.Width = 640; $form.Height = 240
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$box = New-Object System.Windows.Forms.RichTextBox
$box.Dock = 'Fill'
$box.Font = New-Object System.Drawing.Font('Nirmala UI', 14)
$form.Controls.Add($box)
# A button to test "click <name>" and numbered clicking; it writes [clicked] into the box.
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Hamster Button'
$button.Dock = 'Top'
$button.Height = 36
$button.Add_Click({ $box.AppendText('[clicked]') })
$form.Controls.Add($button)
$save = { [System.IO.File]::WriteAllText($OutFile, $box.Text, [System.Text.Encoding]::UTF8) }
$box.Add_TextChanged($save)
$form.Add_Shown({ $form.Activate(); $box.Focus() })
& $save
[System.Windows.Forms.Application]::Run($form)
