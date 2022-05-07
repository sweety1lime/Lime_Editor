function chooseColor() {
    var mycolor = document.getElementById("myColor").value;
    document.execCommand('foreColor', false, mycolor);
}

function changeFont() {
    var myFont = document.getElementById("input-font").value;
    document.execCommand('fontName', false, myFont);
}

function changeSize() {
    var mysize = document.getElementById("fontSize").value;
    document.execCommand('fontSize', false, mysize);
}

function checkDiv() {
    var editorText = document.getElementById("editor1").innerHTML;
    if (editorText === '') {
        document.getElementById("editor1").style.border = '5px solid red';
    }
}

function removeBorder() {
    document.getElementById("editor1").style.border = '1px solid transparent';
}



var options = {
    placeholder: 'Waiting for your precious content',
    theme: 'snow'
};

var editor = new Quill('#editor', options);
function closeEditor() {

    var justHtmlContent = document.getElementById('justHtml');
    var justHtml = editor.root.innerHTML;
    justHtmlContent.innerHTML = justHtml;
    document.getElementById("editor").hidden = true;
    document.getElementById("collapsedbox").hidden = true;
    document.getElementById("collapsedbtn").hidden = true;
}

function save() {

    var justHtmlContent = document.getElementById('justHtml');
    var justHtml = document.getElementById('editor1');
    var html = "";
    html = justHtml.innerHTML;
    justHtmlContent.innerHTML = html;
    document.getElementById("editor1").hidden = true;
    document.getElementById("container").remove() = true;
    document.getElementById("collapsedbtn").remove() = true;
}