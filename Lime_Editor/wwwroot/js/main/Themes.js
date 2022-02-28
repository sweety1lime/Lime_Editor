function toggleTheme(theme) {
    const body = document.body;
    const header = document.header;
    body.classList.remove('dark', 'light')
    if (theme == 'dark') {
        body.classList.add('dark')
    } else {
        body.classList.add('light')
    }

    header.classList.remove('dark', 'light')
    if (theme == 'dark') {
        header.classList.add('dark')
    } else {
        header.classList.add('light')
    }
}