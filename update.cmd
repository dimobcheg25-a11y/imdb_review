@echo off
rem Оновлення: поклади свіжий ratings.csv у цю папку і запусти цей файл.
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
python fetch_tmdb.py || goto :err
python build.py || goto :err
start "" index.html
exit /b 0
:err
echo Щось пішло не так, дивись повідомлення вище.
pause
