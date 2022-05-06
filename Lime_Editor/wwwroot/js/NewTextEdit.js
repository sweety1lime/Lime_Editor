// Elements
const elements = document.querySelectorAll('.btn');

// Event
elements.forEach(element => {
	element.addEventListener('click', () => {
		let command = element.dataset['element'];
		
		if (command == 'createLink' || command == 'insertImage') {
			let url = prompt('Enter the link here:', 'http://');
			document.execCommand(command, false, url);
		} else {
			document.execCommand(command, false, null);
		}
	});
});

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