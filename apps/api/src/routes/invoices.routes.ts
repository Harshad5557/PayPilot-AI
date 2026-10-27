import { Router } from 'express'
import {
  createInvoiceController,
  getInvoiceController,
  listInvoicesController,
  updateInvoiceController,
} from '../controllers/invoices.controller.js'
import { requireAuthentication } from '../middleware/authentication.js'

export const invoicesRouter = Router()

invoicesRouter.use(requireAuthentication)
invoicesRouter.get('/', listInvoicesController)
invoicesRouter.get('/:id', getInvoiceController)
invoicesRouter.post('/', createInvoiceController)
invoicesRouter.patch('/:id', updateInvoiceController)
