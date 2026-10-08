/**
 * HELDERLABS ERP — CRM Contacts & Child Entities Module (crm-contacts.js) v1.6.1
 * Gestão de contactos com poder de decisão, endereços e contratos
 */
(function (window, document) {
  'use strict';

  const CRMContacts = {
    currentCompanyId: null,

    openAddModal(companyId) {
      this.currentCompanyId = companyId;
      const modal = document.getElementById('modal-add-contact');
      if (modal) {
        modal.classList.add('show');
      } else {
        this.renderAndShowAddModal(companyId);
      }
    },

    renderAndShowAddModal(companyId) {
      let modal = document.getElementById('modal-add-contact');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-add-contact';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
          <div class="modal-content" style="max-width: 500px;">
            <div class="modal-header">
              <h3 class="modal-title">Adicionar Pessoa de Contacto</h3>
              <button class="btn btn-sm" onclick="window.CRMModule.closeModal('modal-add-contact')">Fechar</button>
            </div>
            <div class="modal-body">
              <form id="form-add-contact" onsubmit="window.CRMContacts.submitAddContact(event)">
                <div class="form-grid">
                  <div class="form-group col-span-2">
                    <label class="form-label" for="contact-name">Nome Completo *</label>
                    <input id="contact-name" name="name" type="text" class="form-control" required>
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="contact-role">Cargo</label>
                    <input id="contact-role" name="role" type="text" class="form-control" placeholder="Ex.: Diretor Comercial">
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="contact-dept">Departamento</label>
                    <input id="contact-dept" name="department" type="text" class="form-control" placeholder="Ex.: Vendas">
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="contact-email">Email</label>
                    <input id="contact-email" name="email" type="email" class="form-control">
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="contact-phone">Telefone / Telemóvel</label>
                    <input id="contact-phone" name="phone" type="text" class="form-control" placeholder="9xxxxxxxx">
                  </div>
                  <div class="form-group col-span-2">
                    <label class="form-label" for="contact-decision-power">Poder de Decisão</label>
                    <select id="contact-decision-power" name="decisionPower" class="form-control">
                      <option value="DECISOR">Decisor</option>
                      <option value="INFLUENCIADOR">Influenciador</option>
                      <option value="UTILIZADOR">Utilizador</option>
                      <option value="OUTRO">Outro</option>
                    </select>
                  </div>
                  <div class="form-group col-span-2">
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 13px;">
                      <input type="checkbox" name="isPrimary" value="true">
                      Contacto Principal da Empresa
                    </label>
                  </div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                  <button type="button" class="btn" onclick="window.CRMModule.closeModal('modal-add-contact')">Cancelar</button>
                  <button type="submit" class="btn btn-primary">Gravar Contacto</button>
                </div>
              </form>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
      }
      modal.classList.add('show');
    },

    async submitAddContact(event) {
      event.preventDefault();
      const form = event.target;
      const formData = new FormData(form);

      const payload = {
        name: formData.get('name'),
        role: formData.get('role') || null,
        department: formData.get('department') || null,
        email: formData.get('email') || null,
        phone: formData.get('phone') || null,
        decisionPower: formData.get('decisionPower') || null,
        isPrimary: formData.get('isPrimary') === 'true'
      };

      const res = await window.CRMCore.api(`/api/crm/companies/${this.currentCompanyId}/contacts`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        window.CRMModule.closeModal('modal-add-contact');
        form.reset();
        if (window.CRMCompanies && window.CRMCompanies.selectedCompany) {
          await window.CRMCompanies.openCompany360(this.currentCompanyId);
        }
      } else {
        alert(res.data.message || 'Erro ao adicionar contacto.');
      }
    }
  };

  window.CRMContacts = CRMContacts;
})(window, document);
