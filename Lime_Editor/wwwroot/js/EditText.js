const { hidden } = require("modernizr");

var oDoc, sDefTxt;

function initDoc() {
    oDoc = document.getElementById("textBox");
    sDefTxt = oDoc.innerHTML;
    if (document.compForm.switchBox.checked) { setDocMode(true); }
}

function formatDoc(sCmd, sValue) {
    if (validateMode()) { document.execCommand(sCmd, false, sValue); oDoc.focus(); }
}

function validateMode() {
    if (!document.compForm.switchBox.checked) { return true; }
    alert("Uncheck \"Показать HTML\"."); /* убрать галочку из "Показать HTML" */
    oDoc.focus();
    return false;
}

function setDocMode(bToSource) {

    var editor = document.getElementById("userSpace");
    var textBox = null;
    var html = "";

    if (editor == null) {
        alert("Not found userSpace");
        return;
    }
    else {

        textBox = document.getElementById("textBox");
        html = textBox.innerHTML;
        editor.innerHTML = html;
    }

}

function printDoc() {
    if (!validateMode()) { return; }
    var oPrntWin = window.open("", "_blank", "width=450,height=470,left=400,top=100,menubar=yes,toolbar=no,location=no,scrollbars=yes");
    oPrntWin.document.open();
    oPrntWin.document.write("<!doctype html><html><head><title>Print<\/title><\/head><body onload=\"print();\">" + oDoc.innerHTML + "<\/body><\/html>");
    oPrntWin.document.close(); /*  */
}
