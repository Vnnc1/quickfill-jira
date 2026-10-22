import { splitNotes } from "./changelog.js";

const node = (tag, className, text) => {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text) result.textContent = text;
  return result;
};
const dateLabel = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  ? new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)) : "";

/** Dialog nativo: foco contido, Escape, retorno ao acionador e texto remoto sem HTML. */
export function openChangelog(data, actions) {
  if (document.querySelector(".changelog-dialog[open]")) return false;
  document.querySelectorAll(".changelog-dialog:not([open])").forEach((element) => element.remove());
  const dialog = node("dialog", "changelog-dialog");
  dialog.setAttribute("aria-labelledby", "changelogTitle");
  dialog.innerHTML = `<header class="changelog-head">
    <div><h2 id="changelogTitle">Novidades do QuickFill</h2><p class="changelog-context"></p></div>
    <button type="button" class="changelog-close" aria-label="Fechar novidades" autofocus>×</button>
  </header>
  <div class="changelog-content"><nav class="changelog-versions" aria-label="Versões do QuickFill"></nav>
    <section class="changelog-release" aria-label="Alterações da versão selecionada" tabindex="0"></section></div>
  <footer class="changelog-footer"><div class="changelog-install"></div>
    <p class="changelog-status" role="status" aria-live="polite"></p>
    <div class="changelog-actions"></div></footer>`;
  dialog.querySelector(".changelog-context").textContent = `${data.name} · versão instalada ${data.current}`;
  const list = dialog.querySelector(".changelog-versions"), content = dialog.querySelector(".changelog-release");
  const status = dialog.querySelector(".changelog-status"), controls = dialog.querySelector(".changelog-actions");
  const available = data.newer ? data.releases.filter((entry) => entry.version === data.latest) : [];
  const entries = [...available, ...(data.build?.changes?.length || data.build?.files?.length ? [{ ...data.build, draft: true }] : []),
    ...data.releases.filter((entry) => !available.includes(entry))];
  const select = (entry, button) => {
    for (const item of list.children) item.setAttribute("aria-pressed", String(item === button));
    content.replaceChildren(); content.scrollTop = 0;
    const heading = node("div", "changelog-release-head");
    heading.append(node("h3", "", entry.draft ? "Alterações deste build" : `Versão ${entry.version}`),
      node("span", "changelog-state", entry.draft ? "Build local" : entry.version === data.current ? "Instalada" : entry.version === data.latest && data.newer ? "Disponível" : dateLabel(entry.date)));
    content.append(heading);
    if (!entry.draft && entry.date) content.append(node("p", "changelog-date", dateLabel(entry.date)));
    const changes = splitNotes(entry.changes);
    if (changes.length) {
      const ul = node("ul", "changelog-changes");
      for (const change of changes) ul.append(node("li", "", change));
      content.append(ul);
    } else content.append(node("p", "changelog-empty", entry.draft
      ? "Este build inclui alterações nos arquivos abaixo. As notas da próxima versão serão registradas na publicação."
      : "Esta versão não trouxe notas detalhadas."));
    if (entry.draft && entry.files?.length) {
      const details = node("details", "changelog-files");
      details.append(node("summary", "", `${entry.files.length} arquivos alterados`));
      const ul = node("ul");
      for (const file of entry.files) ul.append(node("li", "", file));
      details.append(ul); content.append(details);
    }
  };
  for (const entry of entries) {
    const button = node("button", "changelog-version"); button.type = "button";
    button.append(node("b", "", entry.draft ? "Este build" : entry.version), node("span", "", entry.draft ? "Mudanças locais" : dateLabel(entry.date)));
    button.onclick = () => select(entry, button); list.append(button);
  }
  if (entries.length) select(entries[0], list.firstElementChild);
  else content.append(node("p", "changelog-empty", "O histórico estará disponível no próximo pacote gerado."));

  const action = (label, fn, primary = false) => {
    const button = node("button", `changelog-button${primary ? " is-primary" : ""}`, label); button.type = "button";
    button.onclick = async () => {
      button.disabled = true;
      try { await fn(button); } catch (error) { status.textContent = error.message || "Não foi possível concluir. Tente novamente."; }
      finally { if (button.textContent !== "Atualizando…") button.disabled = false; }
    };
    controls.append(button); return button;
  };
  const install = dialog.querySelector(".changelog-install");
  if (data.newer) {
    install.append(node("p", "", `A versão ${data.latest} está pronta para instalar.`),
      node("p", "changelog-note", "O comando atualiza os arquivos do QuickFill e mantém suas configurações."));
    if (data.nativeAvailable) action("Atualizar agora", (button) => actions.update(button), true);
    if (data.command) {
      action("Copiar comando de atualização", async () => {
        const copied = await actions.copy(data.command);
        status.textContent = copied ? "Comando copiado. Cole no PowerShell e pressione Enter. Ao terminar, recarregue a extensão." : "Selecione e copie o comando abaixo para executar no PowerShell.";
        if (!copied) commandDetails.open = true;
      }, !data.nativeAvailable);
      const commandDetails = node("details", "changelog-command");
      commandDetails.append(node("summary", "", "Comando e instruções"));
      const pre = node("pre"); pre.append(node("code", "", data.command));
      commandDetails.append(pre, node("p", "changelog-note", "Abra o PowerShell, cole o comando e pressione Enter. Depois use Recarregar extensão no QuickFill ou em chrome://extensions."));
      install.append(commandDetails);
    } else if (!data.nativeAvailable) install.append(node("p", "changelog-note", "Execute o atualizar-quickfill.bat fornecido pela equipe e recarregue a extensão."));
  } else install.append(node("p", "changelog-note", "As novidades acompanham cada versão do seu QuickFill."));

  if (!data.nativeAvailable && data.helperCommand) {
    const optional = node("details", "changelog-helper");
    optional.append(node("summary", "", "Ajudante opcional para atualizar com um clique"),
      node("p", "changelog-note", "Instala o Ajudante em Documentos\\QuickFill\\.ajudante. Você pode continuar usando apenas o PowerShell."));
    const button = node("button", "changelog-button", "Copiar comando para ativar Ajudante"); button.type = "button";
    button.onclick = async () => {
      try {
        const copied = await actions.copy(data.helperCommand);
        status.textContent = copied ? "Comando de ativação copiado. Execute no PowerShell e reabra o QuickFill." : "Selecione e copie o comando de ativação abaixo.";
        if (!copied && !optional.querySelector("pre")) { const pre = node("pre"); pre.append(node("code", "", data.helperCommand)); optional.append(pre); }
      } catch (error) { status.textContent = error.message; }
    };
    optional.append(button); install.append(optional);
  }
  action("Continuar no QuickFill", () => dialog.close());
  dialog.querySelector(".changelog-close").onclick = () => dialog.close();
  dialog.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") event.stopPropagation();
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll("button:not(:disabled), summary, [tabindex='0']")]
      .filter((element) => element.getClientRects().length && element.checkVisibility());
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  dialog.addEventListener("close", () => { dialog.remove(); actions.closed?.(); }, { once: true });
  document.body.append(dialog); dialog.showModal();
  return true;
}
