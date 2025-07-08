[Setup]
; Basic installer settings
AppName=OCD File Organizer                  ; The name of your application
AppVersion=1.0                              ; The version of your application
DefaultDirName={autopf}\OCD File Organizer  ; Default installation directory (e.g., C:\Program Files\OCD File Organizer)
DefaultGroupName=OCD File Organizer         ; Default Start Menu program group name
OutputDir=releases                          ; Folder where the compiled installer will be saved (relative to the script)
OutputBaseFilename=OCD                      ; Name of the compiled installer executable (will be OCD.exe)

; CORRECTED COMPRESSION DIRECTIVES
Compression=zip         ; Try 'zip' compression as a test
SolidCompression=yes    ; This should still work with 'zip'

WizardStyle=modern                          ; Modern wizard appearance

; Installer icon file. Assuming 'vite.ico' is copied to the same directory as this .iss script.
SetupIconFile=vite.ico

; Code Signing (VERY IMPORTANT):
; You explicitly stated you do not have signed code.
; THEREFORE, THIS MUST REMAIN COMMENTED OUT.
; If this line were active without a valid certificate, compilation would fail.
; Because this is commented out, the installer will be "unsigned"
; and will likely trigger the "Windows protected your PC" SmartScreen warning.
; SignTool=MyCodeSignTool "$f"