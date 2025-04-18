# frozen_string_literal: true

# Copyright (C) 2025 - present Instructure, Inc.
#
# This file is part of Canvas.
#
# Canvas is free software: you can redistribute it and/or modify it under
# the terms of the GNU Affero General Public License as published by the Free
# Software Foundation, version 3 of the License.
#
# Canvas is distributed in the hope that it will be useful, but WITHOUT ANY
# WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
# A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
# details.
#
# You should have received a copy of the GNU Affero General Public License along
# with this program. If not, see <http://www.gnu.org/licenses/>.

RSpec.describe Canvas::Migration::XMLHelper do
  let(:xml_helper) { Class.new { extend Canvas::Migration::XMLHelper } }

  describe "#open_file_html5" do
    it "handles deeply nested html up to depth of 10_000" do
      html = "<html><body>" + ("<div>" * 9_998) + ("</div>" * 9_998) + "</body></html>"
      file = Tempfile.new("html")
      file.write(html)

      expect { xml_helper.open_file_html5(file.path) }.not_to raise_error
    end

    it "raises error when html is beyond depth of 10_000" do
      html = "<html><body>" + ("<div>" * 9_999) + ("</div>" * 9_999) + "</body></html>"
      file = Tempfile.new("html")
      file.write(html)

      expect { xml_helper.open_file_html5(file.path) }.to raise_error("Document tree depth limit exceeded")
    end
  end
end
