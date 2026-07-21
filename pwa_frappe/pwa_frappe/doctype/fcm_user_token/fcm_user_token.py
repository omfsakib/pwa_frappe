# Copyright (c) 2026, Md Omar Faruk and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class FCMUserToken(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		fcm_token: DF.SmallText
		user: DF.Link

	# end: auto-generated types
	pass
