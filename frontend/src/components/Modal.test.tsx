// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import Modal from "./Modal";

afterEach(cleanup);

/** Reproduz o uso real: aoFechar é uma arrow recriada a cada render do pai. */
function Pai() {
  const [aberto, setAberto] = useState(true);
  const [texto, setTexto] = useState("");
  return (
    <Modal titulo="Teste" aberto={aberto} aoFechar={() => setAberto(false)}>
      <input aria-label="Nome" value={texto} onChange={(e) => setTexto(e.target.value)} />
    </Modal>
  );
}

describe("Modal", () => {
  it("foca o input ao abrir, não o botão de fechar", () => {
    const { getByLabelText } = render(<Pai />);
    expect(document.activeElement).toBe(getByLabelText("Nome"));
  });

  it("mantém o foco no campo enquanto o usuário digita (regressão: foco roubado a cada tecla)", async () => {
    const { getByLabelText } = render(<Pai />);
    const input = getByLabelText("Nome") as HTMLInputElement;
    await userEvent.type(input, "Viagem");
    expect(input.value).toBe("Viagem");
    expect(document.activeElement).toBe(input);
  });

  it("Esc fecha o modal mesmo com aoFechar recriada a cada render", async () => {
    const { getByLabelText, queryByRole } = render(<Pai />);
    await userEvent.type(getByLabelText("Nome"), "abc");
    await userEvent.keyboard("{Escape}");
    expect(queryByRole("dialog")).toBeNull();
  });
});
