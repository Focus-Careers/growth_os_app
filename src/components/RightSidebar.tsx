import React from 'react'
import { ITP, CustomerInput } from '../types/index'
import ApproveTargetsSidebar from './ApproveTargetsSidebar'

import ReviewEmailTemplateSidebar from './ReviewEmailTemplateSidebar'
import SelectSenderSidebar from './SelectSenderSidebar'

interface RightSidebarProps {
  activeSidebar: string
  sidebarData: Record<string, any>
  setSidebarData: (fn: (prev: Record<string, any>) => Record<string, any>) => void
  onSaveCompanyDetails: () => void
  onSidebarAdvance: (messageText?: string) => void
  onSaveItp: () => void
  itpList: ITP[]
  selectedItpId: string | null
  setSelectedItpId: (id: string | null) => void
  manualCustomers: CustomerInput[]
  manualCustomerInput: CustomerInput
  setManualCustomerInput: (fn: (prev: CustomerInput) => CustomerInput) => void
  onAddManualCustomer: () => void
  csvRows: CustomerInput[]
  csvError: string | null
  csvDragOver: boolean
  setCsvDragOver: (v: boolean) => void
  onCsvDrop: (e: any) => void
  onDownloadCsvTemplate: () => void
  userDetailsId: string | null
  API_URL: string
  onApprovalComplete?: (approved: number, rejected: number, hasReasons: boolean) => void
  accountId: string | null
  onTemplateApprove: (updatedSequence: any[]) => void
  onSenderSelect: (senderId: string) => void
  onClose: () => void
  narrow?: boolean
}

const RightSidebar: React.FC<RightSidebarProps> = ({
  activeSidebar,
  sidebarData,
  setSidebarData,
  onSaveCompanyDetails,
  onSidebarAdvance,
  onSaveItp,
  itpList,
  selectedItpId,
  setSelectedItpId,
  manualCustomers,
  manualCustomerInput,
  setManualCustomerInput,
  onAddManualCustomer,
  csvRows,
  csvError,
  csvDragOver,
  setCsvDragOver,
  onCsvDrop,
  onDownloadCsvTemplate,
  userDetailsId,
  API_URL,
  onApprovalComplete,
  accountId,
  onTemplateApprove,
  onSenderSelect,
  onClose,
  narrow,
}) => {
  return (
    <aside id="right-sidebar" className={narrow ? 'sidebar-narrow' : ''}>
      {activeSidebar === 'analyse_website' && (
        <>
          <div id="right-sidebar-header"></div>
          <div id="right-sidebar-body">
            {[
              { key: 'website_url', label: '\uD83C\uDF10 Website URL' },
              { key: 'company_name', label: '\uD83C\uDFED Organisation Name' },
              { key: 'company_description', label: '\u270D\uFE0F Description' },
              { key: 'problem_solved', label: '\uD83E\uDD14 Problem Solved' },
            ].map(({ key, label }) => (
              <div key={key} className="sidebar-field">
                <label className="sidebar-field-label">{label}</label>
                <textarea
                  className="sidebar-field-input"
                  value={sidebarData[key] ?? ''}
                  onChange={e => setSidebarData(prev => ({ ...prev, [key]: e.target.value }))}
                  rows={key === 'company_description' || key === 'problem_solved' ? 4 : 1}
                />
              </div>
            ))}
          </div>
          <div id="right-sidebar-footer">
            <button className="option-pill" onClick={onSaveCompanyDetails}>
              Looks good. Save my company details.
            </button>
          </div>
        </>
      )}

      {activeSidebar === 'define_itp' && (
        <>
          <div id="right-sidebar-header"></div>
          <div id="right-sidebar-body">
            {[
              { key: 'name', label: '\uD83C\uDFF7\uFE0F Name', rows: 1 },
              { key: 'location', label: '\uD83D\uDCCD Location', rows: 1 },
              { key: 'itp_summary', label: '\uD83C\uDFAF ITP Summary', rows: 4 },
              { key: 'demographics', label: '\uD83D\uDC64 Demographics', rows: 4 },
              { key: 'pain_points', label: '\uD83D\uDE23 Pain Points', rows: 4 },
              { key: 'buying_trigger', label: '\u26A1 Buying Trigger', rows: 4 },
            ].map(({ key, label, rows }) => (
              <div key={key} className="sidebar-field">
                <label className="sidebar-field-label">{label}</label>
                <textarea
                  className="sidebar-field-input"
                  value={sidebarData[key] ?? ''}
                  onChange={e => setSidebarData(prev => ({ ...prev, [key]: e.target.value }))}
                  rows={rows}
                />
              </div>
            ))}
          </div>
          <div id="right-sidebar-footer">
            <button className="option-pill" onClick={onSaveItp}>
              Looks good.
            </button>
          </div>
        </>
      )}

      {activeSidebar === 'upload_csv' && (
        <>
          <div id="right-sidebar-header"></div>
          <div id="right-sidebar-body">
            <div className="sidebar-field">
              <label className="sidebar-field-label">Download Template</label>
              <button className="sidebar-link-btn" onClick={onDownloadCsvTemplate}>
                customers_template.csv
              </button>
            </div>
            <div className="sidebar-field">
              <label className="sidebar-field-label">Upload Customer List</label>
              <div
                className={`csv-drop-zone${csvDragOver ? ' drag-over' : ''}`}
                onDragOver={e => { e.preventDefault(); setCsvDragOver(true) }}
                onDragLeave={() => setCsvDragOver(false)}
                onDrop={onCsvDrop}
                onClick={() => document.getElementById('csv-file-input')?.click()}
              >
                {csvRows.length > 0
                  ? <span>{csvRows.length} customer{csvRows.length !== 1 ? 's' : ''} uploaded</span>
                  : <span>Drag a CSV or Excel file here, or click to browse</span>
                }
              </div>
              <input id="csv-file-input" type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={onCsvDrop} />
              {csvError && <p className="csv-error">{csvError}</p>}
            </div>
            {csvRows.length > 0 && (
              <div className="sidebar-field">
                <label className="sidebar-field-label">Preview</label>
                <div className="customer-list">
                  {csvRows.map((r, i) => (
                    <div key={i} className="customer-list-item">
                      <span className="customer-name">{r.organisation_name}</span>
                      {r.organisation_website && <span className="customer-website">{r.organisation_website}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div id="right-sidebar-footer">
            <button className="option-pill" onClick={() => onSidebarAdvance(csvRows.length > 0 ? 'Done' : 'Skip for now')}>
              {csvRows.length > 0 ? 'Done' : 'Skip for now'}
            </button>
          </div>
        </>
      )}

      {activeSidebar === 'add_manually_customers' && (
        <>
          <div id="right-sidebar-header"></div>
          <div id="right-sidebar-body">
            <div className="sidebar-field">
              <label className="sidebar-field-label">Organisation Name</label>
              <input
                className="sidebar-field-input"
                type="text"
                placeholder="Acme Corp"
                value={manualCustomerInput.organisation_name}
                onChange={e => setManualCustomerInput(prev => ({ ...prev, organisation_name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && onAddManualCustomer()}
              />
            </div>
            <div className="sidebar-field">
              <label className="sidebar-field-label">Website</label>
              <input
                className="sidebar-field-input"
                type="text"
                placeholder="https://acmecorp.com"
                value={manualCustomerInput.organisation_website}
                onChange={e => setManualCustomerInput(prev => ({ ...prev, organisation_website: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && onAddManualCustomer()}
              />
            </div>
            <button className="sidebar-add-btn" onClick={onAddManualCustomer}>+ Add customer</button>
            {manualCustomers.length > 0 && (
              <div className="sidebar-field" style={{ marginTop: '16px' }}>
                <label className="sidebar-field-label">Added</label>
                <div className="customer-list">
                  {manualCustomers.map((c, i) => (
                    <div key={i} className="customer-list-item">
                      <span className="customer-name">{c.organisation_name}</span>
                      {c.organisation_website && <span className="customer-website">{c.organisation_website}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div id="right-sidebar-footer">
            <button className="option-pill" onClick={() => onSidebarAdvance(manualCustomers.length > 0 ? 'Done' : 'Skip for now')}>
              {manualCustomers.length > 0 ? 'Done' : 'Skip for now'}
            </button>
          </div>
        </>
      )}

      {activeSidebar === 'select_itp' && (
        <>
          <div id="right-sidebar-header"></div>
          <div id="right-sidebar-body">
            {itpList.length === 0
              ? <p className="sidebar-field-label">No ITPs found for this account.</p>
              : itpList.map(itp => {
                const isSelected = selectedItpId === itp.id
                return (
                  <div
                    key={itp.id}
                    className={`itp-select-card${isSelected ? ' selected' : ''}`}
                    onClick={() => setSelectedItpId(isSelected ? null : itp.id)}
                  >
                    <div className="itp-select-header">
                      <span className="itp-select-name">{itp.name || 'Unnamed ITP'}</span>
                      {isSelected && <span className="itp-selected-label">Selected</span>}
                    </div>
                    <div className="itp-select-body">
                      {itp.itp_summary && <><p className="itp-field-heading">{'\uD83C\uDFAF'} Summary</p><p className="itp-field-text">{itp.itp_summary}</p></>}
                      {itp.itp_demographic && <><p className="itp-field-heading">{'\uD83D\uDC64'} Demographics</p><p className="itp-field-text">{itp.itp_demographic}</p></>}
                      {itp.itp_pain_points && <><p className="itp-field-heading">{'\uD83D\uDE23'} Pain Points</p><p className="itp-field-text">{itp.itp_pain_points}</p></>}
                      {itp.itp_buying_trigger && <><p className="itp-field-heading">{'\u26A1'} Buying Trigger</p><p className="itp-field-text">{itp.itp_buying_trigger}</p></>}
                    </div>
                  </div>
                )
              })
            }
          </div>
          <div id="right-sidebar-footer">
            <button
              className="option-pill"
              disabled={!selectedItpId}
              onClick={async () => {
                await onSidebarAdvance('Yes - sounds good.')
                fetch(`${API_URL}/api/skills/dispatch`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ employee: 'lead_gen_expert', skill: 'target_finder_ten_leads', user_details_id: userDetailsId, inputs: { itp_id: selectedItpId } }),
                }).catch(err => console.error('[select_itp] dispatch error:', err))
              }}
            >
              {selectedItpId ? 'Confirm selection' : 'Choose an ITP'}
            </button>
          </div>
        </>
      )}

      {activeSidebar === 'select_campaign_itp' && (
        <>
          <div id="right-sidebar-header"></div>
          <div id="right-sidebar-body">
            {itpList.length === 0
              ? <p className="sidebar-field-label">No ITPs found for this account.</p>
              : itpList.map(itp => {
                const isSelected = selectedItpId === itp.id
                return (
                  <div
                    key={itp.id}
                    className={`itp-select-card${isSelected ? ' selected' : ''}`}
                    onClick={() => setSelectedItpId(isSelected ? null : itp.id)}
                  >
                    <div className="itp-select-header">
                      <span className="itp-select-name">{itp.name || 'Unnamed ITP'}</span>
                      {isSelected && <span className="itp-selected-label">Selected</span>}
                    </div>
                    <div className="itp-select-body">
                      {itp.itp_summary && <><p className="itp-field-heading">{'\uD83C\uDFAF'} Summary</p><p className="itp-field-text">{itp.itp_summary}</p></>}
                      {itp.itp_demographic && <><p className="itp-field-heading">{'\uD83D\uDC64'} Demographics</p><p className="itp-field-text">{itp.itp_demographic}</p></>}
                      {itp.itp_pain_points && <><p className="itp-field-heading">{'\uD83D\uDE23'} Pain Points</p><p className="itp-field-text">{itp.itp_pain_points}</p></>}
                      {itp.itp_buying_trigger && <><p className="itp-field-heading">{'\u26A1'} Buying Trigger</p><p className="itp-field-text">{itp.itp_buying_trigger}</p></>}
                    </div>
                  </div>
                )
              })
            }
          </div>
          <div id="right-sidebar-footer">
            <button
              className="option-pill"
              disabled={!selectedItpId}
              onClick={() => onSidebarAdvance('ITP selected')}
            >
              {selectedItpId ? 'Confirm selection' : 'Choose an ITP'}
            </button>
          </div>
        </>
      )}

      {activeSidebar === 'target_finder_upload_csv' && (
        <>
          <div id="right-sidebar-header"></div>
          <div id="right-sidebar-body">
            <div className="sidebar-field">
              <label className="sidebar-field-label">Download Template</label>
              <button className="sidebar-link-btn" onClick={onDownloadCsvTemplate}>
                customers_template.csv
              </button>
            </div>
            <div className="sidebar-field">
              <label className="sidebar-field-label">Upload Customer List</label>
              <div
                className={`csv-drop-zone${csvDragOver ? ' drag-over' : ''}`}
                onDragOver={e => { e.preventDefault(); setCsvDragOver(true) }}
                onDragLeave={() => setCsvDragOver(false)}
                onDrop={onCsvDrop}
                onClick={() => document.getElementById('csv-file-input-tf')?.click()}
              >
                {csvRows.length > 0
                  ? <span>{csvRows.length} customer{csvRows.length !== 1 ? 's' : ''} uploaded</span>
                  : <span>Drag a CSV or Excel file here, or click to browse</span>
                }
              </div>
              <input id="csv-file-input-tf" type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={onCsvDrop} />
            </div>
            {csvRows.length > 0 && (
              <div className="sidebar-field">
                <label className="sidebar-field-label">Preview</label>
                <div className="customer-list">
                  {csvRows.map((r, i) => (
                    <div key={i} className="customer-list-item">
                      <span className="customer-name">{r.organisation_name}</span>
                      {r.organisation_website && <span className="customer-website">{r.organisation_website}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div id="right-sidebar-footer">
            <button className="option-pill" onClick={() => onSidebarAdvance(csvRows.length > 0 ? 'Done' : 'Skip for now')}>
              {csvRows.length > 0 ? 'Done' : 'Skip for now'}
            </button>
          </div>
        </>
      )}

      {activeSidebar === 'target_finder_add_manually' && (
        <>
          <div id="right-sidebar-header"></div>
          <div id="right-sidebar-body">
            <div className="sidebar-field">
              <label className="sidebar-field-label">Organisation Name</label>
              <input
                className="sidebar-field-input"
                type="text"
                placeholder="Acme Corp"
                value={manualCustomerInput.organisation_name}
                onChange={e => setManualCustomerInput(prev => ({ ...prev, organisation_name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && onAddManualCustomer()}
              />
            </div>
            <div className="sidebar-field">
              <label className="sidebar-field-label">Website</label>
              <input
                className="sidebar-field-input"
                type="text"
                placeholder="https://acmecorp.com"
                value={manualCustomerInput.organisation_website}
                onChange={e => setManualCustomerInput(prev => ({ ...prev, organisation_website: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && onAddManualCustomer()}
              />
            </div>
            <button className="sidebar-add-btn" onClick={onAddManualCustomer}>+ Add customer</button>
            {manualCustomers.length > 0 && (
              <div className="sidebar-field" style={{ marginTop: '16px' }}>
                <label className="sidebar-field-label">Added</label>
                <div className="customer-list">
                  {manualCustomers.map((c, i) => (
                    <div key={i} className="customer-list-item">
                      <span className="customer-name">{c.organisation_name}</span>
                      {c.organisation_website && <span className="customer-website">{c.organisation_website}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div id="right-sidebar-footer">
            <button className="option-pill" onClick={() => onSidebarAdvance(manualCustomers.length > 0 ? 'Done' : 'Skip for now')}>
              {manualCustomers.length > 0 ? 'Done' : 'Skip for now'}
            </button>
          </div>
        </>
      )}

      {activeSidebar === 'approve_targets' && (
        <>
          <div id="right-sidebar-header"></div>
          <div id="right-sidebar-body" style={{ padding: 0 }}>
            <ApproveTargetsSidebar
              itpId={sidebarData.itp_id}
              userDetailsId={userDetailsId}
              onComplete={onApprovalComplete ?? (() => {})}
              onClose={onClose}
            />
          </div>
        </>
      )}

      {activeSidebar === 'review_email_template' && (
        <>
          <div id="right-sidebar-header"></div>
          <div id="right-sidebar-body">
            <ReviewEmailTemplateSidebar
              campaignId={sidebarData.campaign_id}
              emailSequence={sidebarData.email_sequence ?? []}
              campaignName={sidebarData.campaign_name ?? ''}
              tone={sidebarData.tone}
              numEmails={sidebarData.num_emails ?? 1}
              onApprove={onTemplateApprove}
            />
          </div>
        </>
      )}

      {activeSidebar === 'select_sender' && (
        <>
          <div id="right-sidebar-header"></div>
          <div id="right-sidebar-body">
            <SelectSenderSidebar
              accountId={accountId}
              onSelect={onSenderSelect}
            />
          </div>
        </>
      )}

    </aside>
  )
}

export default RightSidebar
